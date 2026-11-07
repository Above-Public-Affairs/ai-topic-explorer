import { describe, expect, it } from "vitest";
import {
  EntityResolver,
  acronymsOf,
  entityKeyText,
  looksLikeAcronym,
  mentionKeys,
  type MentionInput,
} from "@/lib/extraction";

const org = (name: string, canonicalName?: string): MentionInput => ({ name, type: "organization", canonicalName });
const person = (name: string): MentionInput => ({ name, type: "person" });
const place = (name: string): MentionInput => ({ name, type: "place" });

/** Resolve mentions in order with one resolver; returns the entity id per mention. */
function resolveAll(mentions: MentionInput[], resolver = new EntityResolver([], counter())) {
  const ids = mentions.map((m) => resolver.resolve(m));
  return { ids: ids.map((id) => (id ? resolver.finalId(id) : null)), resolver };
}
function counter() {
  let n = 0;
  return () => `c${++n}`;
}
const same = (mentions: MentionInput[]) => new Set(resolveAll(mentions).ids).size === 1;
const distinct = (mentions: MentionInput[]) => new Set(resolveAll(mentions).ids).size === mentions.length;

describe("key rules", () => {
  it("cleans names into keys", () => {
    expect(entityKeyText("U.S. Department of Energy")).toBe("us department of energy");
    expect(entityKeyText("United States Department of Energy")).toBe("us department of energy");
    expect(entityKeyText("S.B. 6")).toBe("sb 6");
    expect(entityKeyText("Senate Bill No. 6")).toBe("sb 6");
    expect(entityKeyText("SB6")).toBe("sb 6");
    expect(entityKeyText("Oncor Electric Delivery Company LLC")).toBe("oncor electric delivery company");
    expect(entityKeyText("Gov. Greg Abbott", "person")).toBe("greg abbott");
    expect(entityKeyText("Lt. Gov. Dan Patrick", "person")).toBe("dan patrick");
    // Titles only come off people.
    expect(entityKeyText("Governor's Office")).toBe("governor s office");
  });

  it("spots names written as acronyms", () => {
    for (const n of ["ERCOT", "PUCT", "Texas PUC", "SB 6", "U.S. DOE"]) expect(looksLikeAcronym(n)).toBe(true);
    for (const n of ["Ercot", "Texas", "Public Utility Commission of Texas", "A"]) expect(looksLikeAcronym(n)).toBe(false);
  });

  it("builds the acronyms a full name could be written as", () => {
    expect(acronymsOf("electric reliability council of texas")).toEqual(expect.arrayContaining(["ercot", "erct"]));
    expect(acronymsOf("public utility commission of texas")).toEqual(expect.arrayContaining(["puct", "texas puc"]));
    expect(acronymsOf("environmental protection agency")).toEqual(["epa"]);
    // Too short to be a safe acronym, or numbered.
    expect(acronymsOf("energy department")).toEqual([]);
    expect(acronymsOf("texas sb 6 of 2025")).toEqual([]);
  });

  it("uses the model's full name as the main key and the written form as a lookup key", () => {
    const k = mentionKeys(org("Texas PUC", "Public Utility Commission of Texas"));
    expect(k.primary.map((p) => p.key)).toEqual([
      "thing:public utility commission of texas",
      "thing:texas public utility commission",
    ]);
    expect(k.derived).toContain("thing:texas puc");
  });

  it("scopes keys by group", () => {
    expect(mentionKeys(person("Abbott")).primary[0].key).toBe("person:abbott");
    expect(mentionKeys(org("Abbott")).primary[0].key).toBe("thing:abbott");
    expect(mentionKeys({ name: "ERCOT", type: "other" }).primary[0].key).toBe("thing:ercot");
  });
});

describe("merges the same thing named different ways", () => {
  it("ERCOT and Electric Reliability Council of Texas, in either order", () => {
    expect(same([org("ERCOT"), org("Electric Reliability Council of Texas")])).toBe(true);
    expect(same([org("Electric Reliability Council of Texas"), org("ERCOT")])).toBe(true);
    expect(same([org("Electric Reliability Council of Texas (ERCOT)"), org("ERCOT"), org("the Electric Reliability Council of Texas")])).toBe(true);
    expect(same([org("ERCOT"), org("ERCOT (Electric Reliability Council of Texas)")])).toBe(true);
  });

  it("Texas PUC, PUCT and Public Utility Commission of Texas, without the model's help", () => {
    expect(same([org("Texas PUC"), org("Public Utility Commission of Texas")])).toBe(true);
    expect(same([org("Public Utility Commission of Texas"), org("Texas PUC"), org("PUCT")])).toBe(true);
    expect(same([org("Public Utility Commission of Texas"), org("Texas Public Utility Commission")])).toBe(true);
  });

  it("with the model's full name", () => {
    expect(
      same([
        org("Texas PUC", "Public Utility Commission of Texas"),
        org("PUC", "Public Utility Commission of Texas"),
        org("Texas Public Utility Commission", "Public Utility Commission of Texas"),
        org("the state's utility regulator", "Public Utility Commission of Texas"),
      ])
    ).toBe(true);
    expect(same([org("ERCOT", "Electric Reliability Council of Texas"), org("ERCOT")])).toBe(true);
    expect(same([org("ERCOT"), org("ERCOT", "Electric Reliability Council of Texas")])).toBe(true);
  });

  it("federal agencies, bills, companies, people and places", () => {
    expect(same([org("U.S. Department of Energy"), org("US Department of Energy"), org("United States Department of Energy")])).toBe(true);
    expect(same([{ name: "Senate Bill 6", type: "legislation" }, { name: "SB 6", type: "legislation" }, { name: "S.B. 6", type: "other" }])).toBe(true);
    expect(same([{ name: "SB 6", type: "legislation" }, { name: "Senate Bill 6", type: "legislation" }])).toBe(true);
    expect(same([org("Oncor Electric Delivery Company LLC"), org("Oncor Electric Delivery Company")])).toBe(true);
    expect(same([person("Governor Greg Abbott"), person("Greg Abbott"), person("Gov. Greg Abbott")])).toBe(true);
    expect(same([place("Austin, Texas"), place("Austin")])).toBe(true);
  });

  it("keeps merging across runs: a new resolver loaded with stored entities", () => {
    const first = resolveAll([org("ERCOT")]);
    const stored = first.resolver.entities();
    const later = new EntityResolver(stored, counter());
    const id = later.resolve(org("Electric Reliability Council of Texas"));
    expect(id).toBe(stored[0].id);
    const changes = later.changes();
    expect(changes.created).toEqual([]);
    expect(changes.updated[0]).toMatchObject({ id: stored[0].id, name: "Electric Reliability Council of Texas" });
  });

  it("folds two stored entities into one when a mention shows they're the same", () => {
    const stored = [
      { id: "a", name: "ERCOT", group: "thing" as const, aliases: [{ key: "thing:ercot", kind: "acronym" as const }] },
      {
        id: "b",
        name: "Electric Reliability Council of Texas",
        group: "thing" as const,
        // Stored by an older rule set that didn't derive the acronym.
        aliases: [{ key: "thing:electric reliability council of texas", kind: "name" as const }],
      },
    ];
    const r = new EntityResolver(stored, counter());
    expect(r.resolve(org("Electric Reliability Council of Texas (ERCOT)"))).toBe("a");
    expect(r.changes().merged).toEqual([{ from: "b", into: "a" }]);
    expect(r.entities()).toHaveLength(1);
    expect(r.entities()[0].name).toBe("Electric Reliability Council of Texas");
  });
});

describe("doesn't merge different things that look alike", () => {
  it("two full names that share an acronym", () => {
    expect(distinct([org("American Chemistry Council"), org("Arizona Corporation Commission")])).toBe(true);
    // An ambiguous bare acronym joins neither full name.
    const { ids } = resolveAll([org("American Chemistry Council"), org("Arizona Corporation Commission"), org("ACC")]);
    expect(new Set(ids).size).toBe(3);
  });

  it("an acronym already spelled out one way isn't joined by a different full name", () => {
    const { ids } = resolveAll([org("ACC"), org("Arizona Corporation Commission"), org("American Chemistry Council")]);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("the same acronym the model expanded two ways", () => {
    expect(distinct([org("ACC", "Arizona Corporation Commission"), org("ACC", "American Chemistry Council")])).toBe(true);
  });

  it("the same bill number in two states", () => {
    expect(
      distinct([
        { name: "SB 6", type: "legislation", canonicalName: "Texas Senate Bill 6" },
        { name: "SB 6", type: "legislation", canonicalName: "Ohio Senate Bill 6" },
      ])
    ).toBe(true);
  });

  it("the same kind of agency in two states, or state and federal", () => {
    expect(distinct([org("Public Utility Commission of Texas"), org("Public Utility Commission of Ohio")])).toBe(true);
    expect(distinct([org("Texas PUC"), org("Public Utility Commission of Ohio")])).toBe(true);
    expect(distinct([org("Texas Department of Transportation"), org("US Department of Transportation")])).toBe(true);
    expect(distinct([org("Department of Energy"), org("US Department of Energy")])).toBe(true);
    // A bare acronym with no state matches neither.
    const { ids } = resolveAll([org("Public Utility Commission of Texas"), org("Public Utility Commission of Ohio"), org("PUC")]);
    expect(new Set(ids).size).toBe(3);
  });

  it("people and things, and partial names", () => {
    expect(distinct([person("Greg Abbott"), org("Abbott")])).toBe(true);
    expect(distinct([person("Greg Abbott"), person("Abbott")])).toBe(true);
    expect(distinct([person("Dan Patrick"), person("Danica Patrick")])).toBe(true);
  });

  it("places that contain each other's names", () => {
    expect(distinct([place("Texas"), place("West Texas"), org("Texas Tribune"), place("Austin County")])).toBe(true);
    expect(distinct([place("Austin"), place("Austin County")])).toBe(true);
  });

  it("a parenthetical that isn't an acronym or full name", () => {
    // "(2025)" must not become a key that every "X (2025)" shares.
    expect(distinct([{ name: "Senate Bill 6 (2025)", type: "legislation" }, { name: "House Bill 14 (2025)", type: "legislation" }])).toBe(true);
    expect(same([{ name: "Senate Bill 6 (2025)", type: "legislation" }, { name: "SB 6", type: "legislation" }])).toBe(true);
    expect(distinct([org("Oncor (Dallas)"), org("Atmos Energy (Dallas)")])).toBe(true);
  });

  it("a name with nothing left to match on", () => {
    expect(new EntityResolver().resolve(org("—"))).toBeNull();
  });
});
