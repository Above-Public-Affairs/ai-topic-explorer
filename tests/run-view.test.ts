import { describe, expect, it } from "vitest";
import { buildRunView, type RunRows } from "@/lib/results/run-view";

type AnswerRow = RunRows["answers"][number];

function answer(provider: string, over: Partial<AnswerRow> = {}): AnswerRow {
  return {
    provider,
    model: `${provider}-model`,
    requestedModel: `${provider}-model`,
    answer: `${provider} says data centers strain the grid.`,
    errorKind: null,
    citations: [],
    extraction: { tone: "mixed", framing: "A grid story.", errorMessage: null, entities: [], themes: [], arguments: [] },
    ...over,
  };
}

const run = (answers: AnswerRow[]): RunRows => ({ id: "run_1", topic: "Texas data centers", startedAt: new Date(0), answers });

describe("buildRunView", () => {
  it("orders answers Claude, ChatGPT, Gemini, Grok and labels failures", () => {
    const view = buildRunView(
      run([
        answer("grok", { answer: null, model: null, errorKind: "timeout", extraction: null }),
        answer("openai", { answer: "   " }),
        answer("claude"),
      ])
    );
    expect(view.answers.map((a) => [a.provider, a.status, a.errorReason])).toEqual([
      ["claude", "done", undefined],
      ["openai", "failed", "Returned an empty answer"],
      ["grok", "failed", "Timed out"],
    ]);
    expect(view.answers[2].model).toBe("grok-model");
  });

  it("shows cited sources in order, or every source when none is marked cited", () => {
    const c = (url: string, position: number, cited: boolean | null) => ({
      url, domain: new URL(url).hostname, title: null, cited, origin: "provider", position,
    });
    const view = buildRunView(
      run([
        answer("claude", { citations: [c("https://b.com/x", 1, true), c("https://a.com/", 0, true), c("https://seen.com", 2, false), c("https://a.com", 3, true)] }),
        answer("gemini", { citations: [c("https://g.com", 0, false)] }),
      ])
    );
    expect(view.answers[0].sources.map((s) => s.url)).toEqual(["https://a.com/", "https://b.com/x"]);
    expect(view.answers[0].sources[0].title).toBe("a.com");
    expect(view.answers[1].sources.map((s) => s.url)).toEqual(["https://g.com"]);
  });

  it("combines themes, arguments, entities and citations across AIs", () => {
    const ext = (themes: string[], args: [("for" | "against"), string][], entities: [string, string][]) => ({
      tone: "critical",
      framing: null,
      errorMessage: null,
      themes: themes.map((label) => ({ label, normalized: label.toLowerCase(), sentiment: "negative", weight: 0.3 })),
      arguments: args.map(([side, text]) => ({ side, text, sourceUrl: null })),
      entities: entities.map(([name, type]) => ({ name, normalized: name.toLowerCase(), type, mentions: 1, url: null })),
    });
    const cite = { url: "https://ercot.com", domain: "ercot.com", title: "ERCOT", cited: true, origin: "provider", position: 0 };
    const view = buildRunView(
      run([
        answer("claude", { extraction: ext(["Grid strain", "Water use"], [["against", "They raise bills."]], [["ERCOT", "organization"]]), citations: [cite] }),
        answer("openai", { extraction: ext(["grid strain"], [["against", "They raise bills!"], ["for", "Jobs."]], [["Ercot", "organization"], ["Austin", "place"]]), citations: [cite] }),
      ])
    );
    expect(view.themes[0]).toMatchObject({ label: "Grid strain", relevance: 5, providers: ["claude", "openai"], sentiment: "negative" });
    expect(view.themes[1].relevance).toBeLessThan(5);
    expect(view.arguments.against).toEqual([{ text: "They raise bills.", providers: ["claude", "openai"], sourceUrl: null }]);
    expect(view.arguments.for.map((a) => a.text)).toEqual(["Jobs."]);
    expect(view.entities.map((g) => [g.label, g.items.map((e) => [e.name, e.providers])])).toEqual([
      ["Organizations", [["ERCOT", ["claude", "openai"]]]],
      ["Places", [["Austin", ["openai"]]]],
    ]);
    expect(view.citations).toEqual([{ title: "ERCOT", url: "https://ercot.com", domain: "ercot.com", providers: ["claude", "openai"] }]);
  });

  it("shows mentions linked to one merged entity as one row, under its canonical name", () => {
    const harc = { id: "ce_1", name: "Houston Advanced Research Center" };
    const ext = (entities: { name: string; canonical: typeof harc | null }[]) => ({
      tone: null,
      framing: null,
      errorMessage: null,
      themes: [],
      arguments: [],
      entities: entities.map((e) => ({ name: e.name, normalized: e.name.toLowerCase(), type: "organization", mentions: 1, url: null, canonical: e.canonical })),
    });
    const view = buildRunView(
      run([
        answer("claude", { extraction: ext([{ name: "Houston Advanced Research Center (HARC)", canonical: harc }]) }),
        answer("openai", { extraction: ext([{ name: "HARC", canonical: harc }, { name: "TWDB", canonical: null }]) }),
      ])
    );
    expect(view.entities).toEqual([
      {
        label: "Organizations",
        items: [
          { name: "Houston Advanced Research Center", providers: ["claude", "openai"], mentions: 2 },
          { name: "TWDB", providers: ["openai"], mentions: 1 },
        ],
      },
    ]);
  });

  it("hides tone and framing when the extraction failed", () => {
    const view = buildRunView(run([answer("claude", { extraction: { tone: null, framing: null, errorMessage: "boom", entities: [], themes: [], arguments: [] } })]));
    expect(view.answers[0]).toMatchObject({ status: "done", tone: null, framing: null });
  });
});
