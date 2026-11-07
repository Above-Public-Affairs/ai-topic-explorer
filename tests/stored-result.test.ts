import { describe, expect, it } from "vitest";
import { LEGACY_RESULT_SCHEMA_VERSION, RESULT_SCHEMA_VERSION, readRunPointer, readStoredResult, runPointer } from "@/lib/results/stored-result";
import { json } from "./helpers/fixtures";

function read(raw: unknown) {
  const r = readStoredResult(raw);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.result;
}

describe("readStoredResult", () => {
  it("reads a v1 Perplexity-era result into the current shape", () => {
    const result = read(json("stored/v1-perplexity.json"));
    expect(result.schemaVersion).toBe(1);
    expect(result.topic).toBe("Texas data centers");
    expect(result.expandedQueries).toEqual(["texas data center water use", "ERCOT large loads"]);

    // Perplexity's response and error are dropped; the four current ones stay.
    expect(Object.keys(result.responses).sort()).toEqual(["claude", "gemini", "grok", "openai"]);
    expect(result.responses.openai).toBeNull();
    expect(result.responses.claude?.provider).toBe("claude");
    expect(result.errors).toEqual({ openai: "Rate limited — too many requests" });

    // A missing optional list reads as empty (every reader checks .length);
    // a NaN-turned-null frequency reads as 3.
    expect(result.responses.gemini?.usage).toEqual([]);
    expect(result.responses.gemini?.quotedPhrases).toEqual([]);
    expect(result.responses.grok?.quotedPhrases).toEqual([
      { phrase: "Cheap power for them, higher bills for us", frequency: 3 },
      { phrase: "Grid can handle it", frequency: 4 },
    ]);

    // Numeric strings read as numbers; blank words are dropped.
    expect(result.combinedWordFrequencies).toEqual([
      { word: "grid", count: 12 },
      { word: "water", count: 7 },
    ]);

    // Perplexity stays in a provider list where it was stored; an unknown
    // provider is dropped; a blank title falls back to the URL.
    expect(result.combinedEntities.organizations[0].providers).toEqual(["gemini", "perplexity"]);
    expect(result.combinedCitations[1]).toEqual({
      title: "https://example.com/p",
      url: "https://example.com/p",
      domain: "example.com",
      providers: ["perplexity"],
    });
    expect(result.tokenUsage).toHaveLength(2);
  });

  it("round-trips a v2 result", () => {
    const current = {
      schemaVersion: LEGACY_RESULT_SCHEMA_VERSION,
      topic: "water",
      expandedQueries: ["water"],
      responses: {
        claude: null,
        openai: {
          provider: "openai",
          rawText: "text",
          entities: { people: [{ name: "A", url: "https://a" }], organizations: [] },
          citations: [{ title: "T", url: "https://t" }],
          keyThemes: [{ phrase: "p", relevance: 4 }],
          model: "gpt-6-luna",
          usage: [{ inputTokens: 1, outputTokens: 2, purpose: "analysis" }],
        },
        gemini: null,
        grok: null,
      },
      errors: { claude: "Timed out after 150s (claude)" },
      combinedWordFrequencies: [{ word: "water", count: 3 }],
      combinedKeyThemes: [{ phrase: "p", relevance: 4 }],
      combinedEntities: { people: [{ name: "A", url: "https://a", providers: ["openai"] }], organizations: [] },
      combinedCitations: [{ title: "T", url: "https://t", domain: "t", providers: ["openai"] }],
      tokenUsage: [{ inputTokens: 1, outputTokens: 2, purpose: "analysis" }],
    };
    // Absent optional lists come back empty; everything else is unchanged.
    expect(read(current)).toEqual({
      ...current,
      responses: {
        ...current.responses,
        openai: {
          ...current.responses.openai,
          entities: { people: [{ name: "A", url: "https://a", providers: [] }], organizations: [] },
          quotedPhrases: [],
        },
      },
    });
  });

  it("drops a malformed item instead of the whole list", () => {
    const result = read({
      topic: "t",
      responses: {
        claude: {
          rawText: "x",
          entities: { people: [{ name: "" }, { name: "Kept" }, "bare string"], organizations: "oops" },
          citations: [{ title: "no url" }, { url: "https://kept" }],
          keyThemes: [{ phrase: "kept", relevance: "high" }, { relevance: 5 }],
          model: 42,
        },
      },
    });
    const claude = result.responses.claude!;
    expect(claude.entities).toEqual({ people: [{ name: "Kept", providers: [] }], organizations: [] });
    expect(claude.citations).toEqual([{ title: "https://kept", url: "https://kept" }]);
    expect(claude.keyThemes).toEqual([{ phrase: "kept", relevance: 3 }]);
    expect(claude.model).toBe("");
  });

  it("treats an unreadable provider response as missing", () => {
    const result = read({ topic: "t", responses: { claude: "garbage", grok: { rawText: "ok" } } });
    expect(result.responses.claude).toBeNull();
    expect(result.responses.grok?.rawText).toBe("ok");
  });

  it.each([
    [null, "not an object"],
    ["a string", "not an object"],
    [{ topic: "   ", responses: { claude: { rawText: "x" } } }, "no topic"],
    [{ topic: "t", responses: { claude: null, openai: null } }, "no provider responses"],
    [{ topic: "t", responses: { perplexity: { rawText: "only perplexity" } } }, "no provider responses"],
    [{ topic: "t" }, "no provider responses"],
  ])("rejects %j: %s", (raw, reason) => {
    expect(readStoredResult(raw)).toEqual({ ok: false, reason });
  });
});

describe("readRunPointer", () => {
  it("reads a v3 result as a pointer to its run", () => {
    const stored = runPointer("water", "run_1");
    expect(stored.schemaVersion).toBe(RESULT_SCHEMA_VERSION);
    expect(readRunPointer(JSON.parse(JSON.stringify(stored)))).toEqual({ schemaVersion: 3, topic: "water", runId: "run_1" });
  });

  it.each([
    [null],
    ["text"],
    [{ topic: "water", responses: {} }],
    [{ schemaVersion: 2, topic: "water", runId: "run_1" }],
    [{ schemaVersion: 3, topic: "water" }],
  ])("leaves %j to the v1/v2 reader", (raw) => {
    expect(readRunPointer(raw)).toBeNull();
  });
});
