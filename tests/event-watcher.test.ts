import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS,
  STALE_JOB_MS,
  belowBar,
  claimDecision,
  decideSlot,
  dedupeBatch,
  findDuplicate,
  isOfficial,
  itemsForGeography,
  knownDateScopes,
  parseCandidates,
  scanGeographies,
  scanScopes,
  similarity,
  tooOld,
  triggerAtFor,
  type Candidate,
  type KnownEvent,
  type WatchItemRef,
} from "@/lib/watchers/events";

const items: WatchItemRef[] = [
  { id: "dc", name: "Data centers in Texas", topic: "Data centers", geography: "Texas", subTopics: ["power generation", "water use", "noise"] },
  { id: "og", name: "Oil and gas in New Mexico", topic: "Oil and gas", geography: "New Mexico", subTopics: [] },
  { id: "re", name: "Renewables in Texas", topic: "Renewables", geography: "Texas", subTopics: ["wind", "solar", "BESS"] },
];
const refs = new Map([
  ["W1", "dc"],
  ["W2", "og"],
  ["W3", "re"],
]);

function event(over: Partial<Record<string, unknown>> = {}) {
  return {
    title: "Texas PUC adopts new rule on large loads connecting to ERCOT",
    category: "major_news",
    watchItems: ["W1"],
    geography: "Texas",
    occurredOn: "2026-11-09",
    occurredTime: null,
    sourceUrl: "https://www.texastribune.org/2026/11/09/puc-large-load-rule/?utm_source=x",
    sourceName: "The Texas Tribune",
    whyItClearsTheBar: "A statewide rule on data center grid connections.",
    duplicateOf: null,
    ...over,
  };
}

function cand(over: Partial<Candidate> = {}): Candidate {
  return {
    title: "Texas PUC adopts new rule on large loads connecting to ERCOT",
    category: "major_news",
    watchItemIds: ["dc"],
    geography: "Texas",
    occurredAt: new Date("2026-11-09T18:00:00Z"),
    dateOnly: true,
    sourceUrl: "https://www.texastribune.org/a",
    sourceName: "The Texas Tribune",
    why: "",
    duplicateOf: null,
    ...over,
  };
}

describe("geographies and scopes", () => {
  it("derives geographies from the active items, deduped, plus federal", () => {
    expect(scanGeographies(items)).toEqual(["Texas", "New Mexico", "federal"]);
    expect(scanGeographies([...items, { geography: "texas" }, { geography: null }, { geography: "Arizona" }])).toEqual(["Texas", "New Mexico", "Arizona", "federal"]);
  });

  it("gives a state's events to that state's items and federal events to all", () => {
    expect(itemsForGeography(items, "Texas").map((i) => i.id)).toEqual(["dc", "re"]);
    expect(itemsForGeography(items, "new mexico").map((i) => i.id)).toEqual(["og"]);
    expect(itemsForGeography(items, "federal")).toHaveLength(3);
    expect(itemsForGeography(items, null)).toHaveLength(3);
  });

  it("scans AI events, each geography and federal, with every category but new_model", () => {
    const scopes = scanScopes(items, scanGeographies(items));
    expect(scopes.map((s) => s.name)).toEqual(["ai", "Texas", "New Mexico", "federal"]);
    expect(scopes.flatMap((s) => s.categories)).not.toContain("new_model");
    expect(new Set(scopes.flatMap((s) => s.categories))).toEqual(new Set(["model_policy", "crawler_change", "election", "legislative_session", "major_news"]));
    expect(knownDateScopes(items, scanGeographies(items)).map((s) => s.name)).toEqual([
      "Texas elections",
      "Texas sessions",
      "New Mexico elections",
      "New Mexico sessions",
      "federal elections",
      "federal sessions",
    ]);
  });
});

describe("parseCandidates", () => {
  it("parses a valid event, maps refs, strips tracking params and places a date-only event at 18:00 UTC", () => {
    const { candidates, dropped } = parseCandidates({ events: [event({ watchItems: ["W1", "W3", "W9"] })] }, refs);
    expect(dropped).toEqual([]);
    expect(candidates[0]).toMatchObject({
      category: "major_news",
      watchItemIds: ["dc", "re"],
      geography: "Texas",
      dateOnly: true,
      sourceUrl: "https://www.texastribune.org/2026/11/09/puc-large-load-rule/",
      sourceName: "The Texas Tribune",
    });
    expect(candidates[0].occurredAt.toISOString()).toBe("2026-11-09T18:00:00.000Z");
  });

  it("uses a given time", () => {
    const { candidates } = parseCandidates({ events: [event({ occurredTime: "14:30" })] }, refs);
    expect(candidates[0].occurredAt.toISOString()).toBe("2026-11-09T14:30:00.000Z");
    expect(candidates[0].dateOnly).toBe(false);
  });

  it("drops new_model, unknown categories, bad dates, bad URLs and events with no known item", () => {
    const { candidates, dropped } = parseCandidates(
      {
        events: [
          event({ category: "new_model" }),
          event({ category: "sports" }),
          event({ occurredOn: "2026-02-30" }),
          event({ occurredOn: "Nov 9" }),
          event({ sourceUrl: "javascript:alert(1)" }),
          event({ sourceUrl: "not a url" }),
          event({ watchItems: ["W9"] }),
          event({ title: "  " }),
          "junk",
        ],
      },
      refs
    );
    expect(candidates).toEqual([]);
    expect(dropped.map((d) => d.reason)).toEqual([
      "category new_model isn't watched here",
      "category sports isn't watched here",
      "bad date 2026-02-30",
      "bad date Nov 9",
      "bad source URL javascript:alert(1)",
      "bad source URL not a url",
      "no known watch item",
      "no title",
    ]);
  });

  it("maps duplicateOf refs to event ids, and ignores unknown refs", () => {
    const eventRefs = new Map([["E1", "evt_1"]]);
    expect(parseCandidates({ events: [event({ duplicateOf: "E1" })] }, refs, eventRefs).candidates[0].duplicateOf).toBe("evt_1");
    expect(parseCandidates({ events: [event({ duplicateOf: "E7" })] }, refs, eventRefs).candidates[0].duplicateOf).toBeNull();
  });

  it("handles a response with no events list", () => {
    expect(parseCandidates(null, refs).candidates).toEqual([]);
    expect(parseCandidates({ events: "none" }, refs).candidates).toEqual([]);
  });

  it("falls back to the host as source name", () => {
    expect(parseCandidates({ events: [event({ sourceName: "" })] }, refs).candidates[0].sourceName).toBe("texastribune.org");
  });
});

describe("the bar", () => {
  it("never counts hearings, nor routine groundbreakings and openings", () => {
    expect(belowBar({ title: "Senate committee holds hearing on data center water use", why: "", category: "major_news" })).toMatch(/hearings/);
    expect(belowBar({ title: "Company breaks ground on Abilene data center", why: "", category: "major_news" })).toMatch(/groundbreakings/);
    expect(belowBar({ title: "Ribbon-cutting for new solar farm", why: "", category: "major_news" })).toMatch(/openings/);
    expect(belowBar({ title: "Governor signs data center siting law", why: "", category: "major_news" })).toBeNull();
    expect(belowBar({ title: "Legislature opens special session", why: "", category: "legislative_session" })).toBeNull();
  });

  it("drops unscheduled events found more than 4 days late", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(tooOld(new Date("2026-11-07T12:00:00Z"), now)).toBeNull();
    expect(tooOld(new Date("2026-11-05T12:00:00Z"), now)).toMatch(/more than 4 days/);
  });

  it("accepts only .gov and .us pages as official calendar sources", () => {
    expect(isOfficial("https://www.sos.state.tx.us/elections/")).toBe(true);
    expect(isOfficial("https://www.nmlegis.gov/Publications/Session_Dates.pdf")).toBe(true);
    expect(isOfficial("https://www.senate.gov/legislative/DatesofSessionsofCongress.htm")).toBe(true);
    expect(isOfficial("https://ballotpedia.org/Texas_elections")).toBe(false);
    expect(isOfficial("https://gov.example.com/")).toBe(false);
  });
});

describe("dedup", () => {
  const known: KnownEvent[] = [
    { id: "k1", title: "Texas PUC adopts large-load interconnection rule for ERCOT", category: "major_news", geography: "Texas", occurredAt: new Date("2026-11-09T18:00:00Z"), sourceUrl: "https://www.kut.org/x", watchItemId: "dc" },
    { id: "k2", title: "90th Texas Legislature regular session begins", category: "legislative_session", geography: "Texas", occurredAt: new Date("2027-01-12T18:00:00Z"), sourceUrl: "https://capitol.texas.gov/", watchItemId: "dc" },
  ];

  it("treats the same story from another outlet as a repeat", () => {
    expect(similarity("Texas PUC adopts new rule on large loads connecting to ERCOT", known[0].title)).toBeGreaterThanOrEqual(0.6);
    expect(findDuplicate(cand(), known)?.id).toBe("k1");
  });

  it("matches on the same source URL, or when the model says so", () => {
    expect(findDuplicate(cand({ title: "Something else entirely", sourceUrl: "https://www.kut.org/x" }), known)?.id).toBe("k1");
    expect(findDuplicate(cand({ title: "Something else entirely", duplicateOf: "k1" }), known)?.id).toBe("k1");
  });

  it("keeps different stories, and the same headline weeks apart", () => {
    expect(findDuplicate(cand({ title: "New Mexico regulators approve methane rule", sourceUrl: "https://a.example/b" }), known)).toBeNull();
    expect(findDuplicate(cand({ occurredAt: new Date("2026-12-09T18:00:00Z") }), known)).toBeNull();
  });

  it("treats a session or election date in the same geography within 2 days as the same", () => {
    const c = cand({ title: "Texas lawmakers gavel in 2027 session", category: "legislative_session", occurredAt: new Date("2027-01-13T15:00:00Z"), sourceUrl: "https://www.texastribune.org/s" });
    expect(findDuplicate(c, known)?.id).toBe("k2");
    expect(findDuplicate({ ...c, geography: "New Mexico" }, known)).toBeNull();
  });

  it("merges repeats inside one scan, keeping the union of items", () => {
    const out = dedupeBatch([
      cand({ watchItemIds: ["dc"] }),
      cand({ title: "PUC adopts rule for large loads connecting to ERCOT grid", sourceUrl: "https://kxan.com/y", watchItemIds: ["re"] }),
      cand({ title: "New Mexico regulators approve methane rule", sourceUrl: "https://a.example/b", watchItemIds: ["og"] }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].watchItemIds).toEqual(["dc", "re"]);
  });
});

describe("scheduling", () => {
  const t = (iso: string) => new Date(iso);

  it("sets the snapshot about 24h after the event", () => {
    expect(triggerAtFor(t("2026-11-09T18:00:00Z")).toISOString()).toBe("2026-11-10T18:00:00.000Z");
  });

  it("takes a new slot when the week has room", () => {
    expect(decideSlot(t("2026-11-11T18:00:00Z"), [])).toEqual({ kind: "new", triggerAt: t("2026-11-11T18:00:00Z") });
    expect(decideSlot(t("2026-11-13T18:00:00Z"), [{ triggerAt: t("2026-11-10T18:00:00Z"), started: true }])).toMatchObject({ kind: "new" });
  });

  it("caps at 2 event snapshots per item per week (weeks start Monday 00:00 UTC)", () => {
    const slots = [
      { triggerAt: t("2026-11-09T18:00:00Z"), started: true },
      { triggerAt: t("2026-11-11T18:00:00Z"), started: true },
    ];
    const d = decideSlot(t("2026-11-14T18:00:00Z"), slots);
    expect(d.kind).toBe("capped");
    expect(d.kind === "capped" && d.reason).toMatch(/weekly cap: 2 event snapshots .* week of 2026-11-09/);
    // Next Monday is a new week.
    expect(decideSlot(t("2026-11-16T18:00:00Z"), slots)).toMatchObject({ kind: "new" });
  });

  it("shares a not-yet-started slot within 24h instead of using up the cap", () => {
    const slots = [{ triggerAt: t("2026-11-11T18:00:00Z"), started: false }];
    expect(decideSlot(t("2026-11-11T09:00:00Z"), slots)).toEqual({ kind: "join", triggerAt: t("2026-11-11T18:00:00Z") });
    // A later event moves the shared slot later, so the snapshot still comes ~24h after it.
    expect(decideSlot(t("2026-11-12T06:00:00Z"), slots)).toEqual({ kind: "join", triggerAt: t("2026-11-12T06:00:00Z"), moveFrom: t("2026-11-11T18:00:00Z") });
    // A started slot can't be joined.
    expect(decideSlot(t("2026-11-11T20:00:00Z"), [{ triggerAt: t("2026-11-11T18:00:00Z"), started: true }])).toMatchObject({ kind: "new" });
  });

  it("joining a slot is allowed even when the week is full", () => {
    const slots = [
      { triggerAt: t("2026-11-09T18:00:00Z"), started: true },
      { triggerAt: t("2026-11-11T18:00:00Z"), started: false },
    ];
    expect(decideSlot(t("2026-11-11T12:00:00Z"), slots)).toMatchObject({ kind: "join" });
  });
});

describe("idempotency (cron runs on every deploy)", () => {
  const now = new Date("2026-11-10T13:00:00Z");
  it("takes a new job, and skips one already done", () => {
    expect(claimDecision(null, now)).toEqual({ take: "new" });
    expect(claimDecision({ status: "complete", attempts: 1, startedAt: now }, now)).toEqual({ skip: "already complete" });
    expect(claimDecision({ status: "skipped", attempts: 1, startedAt: now }, now)).toEqual({ skip: "already skipped" });
  });

  it("leaves a running job alone until it's stale", () => {
    expect(claimDecision({ status: "running", attempts: 1, startedAt: new Date(now.getTime() - 60_000) }, now)).toEqual({ skip: "running in another process" });
    expect(claimDecision({ status: "running", attempts: 1, startedAt: new Date(now.getTime() - STALE_JOB_MS - 1) }, now)).toEqual({ take: "retry" });
  });

  it("retries a failed job, up to the attempt limit", () => {
    expect(claimDecision({ status: "failed", attempts: 1, startedAt: now }, now)).toEqual({ take: "retry" });
    expect(claimDecision({ status: "failed", attempts: MAX_ATTEMPTS, startedAt: now }, now)).toEqual({ skip: `gave up after ${MAX_ATTEMPTS} attempts` });
  });
});
