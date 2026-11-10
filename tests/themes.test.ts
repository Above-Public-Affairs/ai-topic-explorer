import { describe, expect, it } from "vitest";
import {
  THEME_VOCAB,
  buildMapperInput,
  lookupKeys,
  mapLabels,
  mapperSchema,
  newThemeSlug,
  parseMapperOutput,
  themeKey,
  vocabAliasKeys,
  type MapperTheme,
} from "@/lib/themes";
import { firstJsonObject } from "@/lib/themes/mapper";
import { themeFindingKey } from "@/lib/snapshots";
import type { ModelChoice } from "@/lib/answers/registry";

const SUB_TOPICS: Record<string, string[]> = {
  "Data centers in Texas": ["power generation", "water use", "noise"],
  "Oil and gas in New Mexico": [],
  "Renewables in Texas": ["wind", "solar", "BESS"],
};

/** The vocabulary entry a label reaches with no AI call, or null (it would go to the mapper). */
function aliasSlug(item: string, label: string, subTopic: string | null = null): string | null {
  const index = new Map<string, string>();
  for (const e of THEME_VOCAB[item]) for (const k of vocabAliasKeys(e)) index.set(k, e.slug);
  return lookupKeys(label, subTopic).map((k) => index.get(k)).find(Boolean) ?? null;
}

describe("themeKey", () => {
  it("folds case, punctuation and plurals of the same words", () => {
    expect(themeKey("Electricity Bills")).toBe(themeKey("electricity bill"));
    expect(themeKey("tax breaks")).toBe("tax break");
    expect(themeKey("Taxes")).toBe("tax");
    expect(themeKey("utilities")).toBe("utility");
    expect(themeKey("On-site generation")).toBe("on site generation");
    expect(themeKey("Noise sources & levels")).toBe("noise source and level");
  });

  it("leaves words that aren't plurals alone", () => {
    expect(themeKey("natural gas")).toBe("natural gas");
    expect(themeKey("Texas business")).toBe("texas business");
    expect(themeKey("cost analysis")).toBe("cost analysis");
    expect(themeKey("methane emissions")).toBe(themeKey("methane emission"));
  });

  it("never merges different words: that is the vocabulary's job", () => {
    expect(themeKey("power demand")).not.toBe(themeKey("electricity demand"));
    expect(themeKey("water use")).not.toBe(themeKey("water reporting"));
  });

  it("is empty for a label with no letters or digits", () => {
    expect(themeKey(" -- ")).toBe("");
    expect(lookupKeys(" -- ", null)).toEqual([]);
  });
});

describe("theme vocabulary", () => {
  for (const [item, vocab] of Object.entries(THEME_VOCAB)) {
    describe(item, () => {
      it("has unique, stable slugs", () => {
        const slugs = vocab.map((e) => e.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
        for (const s of slugs) {
          expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
          expect(s.startsWith("new-")).toBe(false);
        }
      });

      it("names only the item's own sub-topics", () => {
        for (const e of vocab) if (e.subTopic) expect(SUB_TOPICS[item]).toContain(e.subTopic);
      });

      it("gives no alias to two entries", () => {
        const owner = new Map<string, string>();
        for (const e of vocab)
          for (const k of vocabAliasKeys(e)) {
            const was = owner.get(k);
            expect(was === undefined || was === e.slug, `${k}: ${was} and ${e.slug}`).toBe(true);
            owner.set(k, e.slug);
          }
      });

      it("describes every entry", () => {
        for (const e of vocab) expect(e.description.length).toBeGreaterThan(20);
      });
    });
  }
});

describe("merging by alias (no AI call)", () => {
  const dc = "Data centers in Texas";

  it("merges the same idea worded differently", () => {
    expect(aliasSlug(dc, "power demand")).toBe("electricity-demand");
    expect(aliasSlug(dc, "Electricity Demand")).toBe("electricity-demand");
    expect(aliasSlug(dc, "tax breaks")).toBe("tax-incentives");
    expect(aliasSlug(dc, "Tax Incentives")).toBe("tax-incentives");
    expect(aliasSlug(dc, "water consumption", "water use")).toBe("water-consumption");
    expect(aliasSlug(dc, "water use", "water use")).toBe("water-consumption");
    expect(aliasSlug(dc, "Low-frequency hum", "noise")).toBe("noise-sources");
  });

  it("keeps different ideas apart (false-merge cases)", () => {
    const pairs: [string, string, string | null][] = [
      ["electricity demand", "electricity costs", "power generation"],
      ["grid reliability", "electricity bills", "power generation"],
      ["cost allocation", "electricity costs", "power generation"],
      ["water use", "water reporting", "water use"],
      ["water consumption", "local water stress", "water use"],
      ["water consumption", "indirect water use", "water use"],
      ["reclaimed water use", "water consumption", "water use"],
      ["noise sources", "noise limits", "noise"],
      ["noise mitigation", "sleep disruption", "noise"],
      ["tax incentives", "tax revenue", null],
      ["jobs", "tax revenue", null],
      ["jobs", "economic benefits", null],
    ];
    for (const [a, b, sub] of pairs) {
      const sa = aliasSlug(dc, a, sub);
      const sb = aliasSlug(dc, b, sub);
      expect(sa, a).not.toBeNull();
      expect(sb, b).not.toBeNull();
      expect(sa, `${a} vs ${b}`).not.toBe(sb);
    }
  });

  it("keeps the same words apart across watch items", () => {
    // Same slug name, but CanonicalTheme rows and aliases are per watch item.
    expect(aliasSlug("Oil and gas in New Mexico", "water use")).toBe("water-use");
    expect(aliasSlug(dc, "water use")).toBe("water-consumption");
  });

  it("matches a sub-topic entry's alias only under that sub-topic or none", () => {
    expect(aliasSlug(dc, "noise limits", "noise")).toBe("noise-rules");
    expect(aliasSlug(dc, "noise limits", null)).toBe("noise-rules");
    expect(aliasSlug(dc, "noise limits", "water use")).toBeNull();
  });

  it("leaves a sub-topic label to the mapper rather than an overall entry", () => {
    // "neighbor impacts" under noise is a noise effect, not the overall community theme.
    expect(aliasSlug(dc, "neighbor impacts", null)).toBe("community-impacts");
    expect(aliasSlug(dc, "neighbor impacts", "noise")).toBeNull();
  });

  it("leaves vague labels to the mapper", () => {
    for (const label of ["impacts", "concerns", "uncertainty", "costs", "local regulation", "local impacts"]) {
      expect(aliasSlug(dc, label), label).toBeNull();
    }
  });

  it("names new themes by sub-topic and key", () => {
    expect(newThemeSlug("-", "infrastructure cost")).toBe("new-infrastructure-cost");
    expect(newThemeSlug("water use", "treatment challenge")).toBe("new-water-use-treatment-challenge");
  });
});

describe("label mapper", () => {
  const themes: MapperTheme[] = [
    { slug: "electricity-demand", name: "Electricity demand growth", subTopic: "power generation", description: "How much more power." },
    { slug: "tax-incentives", name: "Tax breaks", subTopic: null, description: null },
  ];
  const settings: ModelChoice = { provider: "openai", model: "gpt-6-luna", effortLevel: "none", registryId: null, source: "fallback" } as ModelChoice;

  it("limits the answer to the item's slugs or new", () => {
    const schema = mapperSchema(themes.map((t) => t.slug));
    expect(schema.properties.choices.items.properties.theme.enum).toEqual(["electricity-demand", "tax-incentives", "new"]);
  });

  it("quotes labels with their sub-topic", () => {
    const input = buildMapperInput("Data centers", themes, [{ label: "power demand", subTopic: "power generation" }]);
    expect(input).toContain('0. "power demand" [sub-topic: power generation]');
    expect(input).toContain("- electricity-demand: Electricity demand growth [sub-topic: power generation]. How much more power.");
  });

  it("treats missing, repeated, out-of-range or unknown choices as new", () => {
    const slugs = themes.map((t) => t.slug);
    const raw = {
      choices: [
        { index: 0, theme: "electricity-demand" },
        { index: 0, theme: "tax-incentives" },
        { index: 2, theme: "made-up" },
        { index: 9, theme: "tax-incentives" },
        { index: 1.5, theme: "tax-incentives" },
      ],
    };
    expect(parseMapperOutput(raw, 4, slugs)).toEqual(["electricity-demand", "new", "new", "new"]);
    expect(parseMapperOutput(null, 2, slugs)).toEqual(["new", "new"]);
  });

  it("reads the first JSON object when the model repeats itself", () => {
    const one = '{"choices":[{"index":0,"theme":"a}b"}]}';
    expect(firstJsonObject(`${one}${one}`)).toEqual({ choices: [{ index: 0, theme: "a}b" }] });
    expect(() => firstJsonObject('{"choices":[')).toThrow(/incomplete/);
  });

  function fakeClient(answer: (labels: string[]) => string[], calls: string[][]) {
    return {
      responses: {
        create: async (req: { input: string }) => {
          const labels = [...req.input.matchAll(/^\d+\. "([^"]+)"/gm)].map((m) => m[1]);
          calls.push(labels);
          if (labels.includes("flagged label") && labels.length >= 1) {
            if (labels.length > 1 || labels[0] === "flagged label") throw Object.assign(new Error("Invalid prompt: flagged"), { status: 400, code: "invalid_prompt" });
          }
          const choices = answer(labels).map((theme, index) => ({ index, theme }));
          return { status: "completed", output_text: JSON.stringify({ choices }), usage: { input_tokens: 100, output_tokens: 10 } };
        },
      },
    } as never;
  }

  it("maps in order and costs nothing when there are no themes", async () => {
    const calls: string[][] = [];
    const client = fakeClient((ls) => ls.map((l) => (l.includes("demand") ? "electricity-demand" : "new")), calls);
    const out = await mapLabels("Data centers", themes, [{ label: "power demand", subTopic: null }, { label: "odd one", subTopic: null }], { client, settings });
    expect(out.choices).toEqual(["electricity-demand", "new"]);
    expect(calls).toHaveLength(1);

    const none = await mapLabels("Data centers", [], [{ label: "power demand", subTopic: null }], { client, settings });
    expect(none).toEqual({ choices: ["new"], costUsd: 0 });
    expect(calls).toHaveLength(1);
  });

  it("splits a batch the prompt filter refuses until the refused label is alone", async () => {
    const calls: string[][] = [];
    const client = fakeClient((ls) => ls.map(() => "tax-incentives"), calls);
    const labels = ["tax breaks", "flagged label", "tax exemptions", "tax abatements"].map((label) => ({ label, subTopic: null }));
    const out = await mapLabels("Data centers", themes, labels, { client, settings });
    expect(out.choices).toEqual(["tax-incentives", "new", "tax-incentives", "tax-incentives"]);
  });

  it("passes other errors through", async () => {
    const client = { responses: { create: async () => Promise.reject(Object.assign(new Error("rate limited"), { status: 429 })) } } as never;
    await expect(mapLabels("x", themes, [{ label: "a", subTopic: null }], { client, settings })).rejects.toThrow("rate limited");
  });
});

describe("theme findings", () => {
  it("keys a linked mention by its theme and an unlinked one by its label", () => {
    expect(themeFindingKey({ normalized: "power demand", canonical: { slug: "electricity-demand" } })).toBe("t:electricity-demand");
    expect(themeFindingKey({ normalized: "power demand", canonical: null })).toBe("power demand");
  });
});
