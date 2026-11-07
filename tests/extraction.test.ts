import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { EXTRACTION_DEFAULT, FREE_TIER_DEFAULTS, PROVIDERS, ProviderError, TEXAS_LOCATION, type AskResult } from "@/lib/answers";
import {
  EXTRACTION_JSON_SCHEMA,
  EXTRACTION_MODEL,
  PROMPT_VERSION,
  answerCreateData,
  buildExtractionInput,
  cleanUrl,
  domainOf,
  extractAnswer,
  extractedCitationRows,
  extractionCreateData,
  ExtractionParseError,
  failedAnswerCreateData,
  normalizeName,
  parseExtraction,
  providerCitationRows,
  type ResponsesClient,
} from "@/lib/extraction";
import { runPipeline } from "@/lib/pipeline/run";

const sample = {
  tone: "mixed",
  framing: "Frames Texas data centers as an economic boon that strains the grid.",
  entities: [
    { name: "ERCOT", canonicalName: "Electric Reliability Council of Texas", type: "organization", mentions: 3, url: "https://www.ercot.com/" },
    { name: "ercot", canonicalName: "ERCOT", type: "organization", mentions: 1, url: null },
    { name: "Senate Bill 6", canonicalName: "Senate Bill 6", type: "legislation", mentions: 1, url: null },
    { name: "  ", type: "person", mentions: 1, url: null },
    { name: "Abilene", type: "city", mentions: 0, url: "not a url" },
  ],
  themes: [
    { label: "Grid reliability", sentiment: "negative", weight: 0.4, subTopic: "power generation" },
    { label: "grid reliability!", sentiment: "neutral", weight: 0.1, subTopic: null },
    { label: "Water use", sentiment: "Mixed", weight: 1.7, subTopic: "Water Use" },
    { label: "Jobs", sentiment: "upbeat", weight: -1, subTopic: "jobs" },
  ],
  arguments: [
    { side: "for", text: "Data centers bring tax revenue.", sourceUrl: "https://example.com/tax)." },
    { side: "for", text: "Data centers bring tax revenue.", sourceUrl: null },
    { side: "against", text: "They raise demand on the grid.", sourceUrl: null },
    { side: "sideways", text: "Ignored.", sourceUrl: null },
  ],
  sources: [
    { name: "Texas Tribune", url: "https://www.texastribune.org/2026/data-centers/" },
    { name: "Texas Tribune", url: "https://www.texastribune.org/2026/data-centers/" },
    { name: "ERCOT", url: null },
  ],
};

const SUB_TOPICS = ["Power generation", "Water use", "Noise"];

describe("normalizeName / cleanUrl / domainOf", () => {
  it("normalizes names for cross-answer matching", () => {
    expect(normalizeName("The Electric Reliability Council of Texas")).toBe("electric reliability council of texas");
    expect(normalizeName("AT&T")).toBe("at and t");
    expect(normalizeName("Público, Inc.")).toBe("publico inc");
  });
  it("keeps only http(s) URLs and trims trailing punctuation", () => {
    expect(cleanUrl("https://a.com/x).")).toBe("https://a.com/x");
    expect(cleanUrl("ftp://a.com")).toBeNull();
    expect(cleanUrl("nope")).toBeNull();
    expect(cleanUrl(null)).toBeNull();
  });
  it("takes the hostname without www", () => {
    expect(domainOf("https://www.TexasTribune.org/a")).toBe("texastribune.org");
    expect(domainOf("bad")).toBeNull();
  });
});

describe("parseExtraction", () => {
  const r = parseExtraction(sample, SUB_TOPICS);

  it("reads tone and framing", () => {
    expect(r.tone).toBe("mixed");
    expect(r.framing).toMatch(/economic boon/);
  });

  it("merges entities by normalized name and cleans fields", () => {
    expect(r.entities).toEqual([
      { name: "ERCOT", normalized: "ercot", type: "organization", mentions: 4, url: "https://www.ercot.com/", canonicalName: "Electric Reliability Council of Texas" },
      // A canonical name that only repeats the name isn't kept.
      { name: "Senate Bill 6", normalized: "senate bill 6", type: "legislation", mentions: 1, url: null, canonicalName: null },
      { name: "Abilene", normalized: "abilene", type: "other", mentions: 1, url: null, canonicalName: null },
    ]);
  });

  it("dedupes themes, clamps weights and matches sub-topics as given", () => {
    expect(r.themes).toEqual([
      { label: "Grid reliability", normalized: "grid reliability", sentiment: "negative", weight: 0.4, subTopic: "Power generation" },
      { label: "Water use", normalized: "water use", sentiment: "mixed", weight: 1, subTopic: "Water use" },
      { label: "Jobs", normalized: "jobs", sentiment: null, weight: 0, subTopic: null },
    ]);
  });

  it("keeps valid, distinct arguments and sources", () => {
    expect(r.arguments).toEqual([
      { side: "for", text: "Data centers bring tax revenue.", sourceUrl: "https://example.com/tax" },
      { side: "against", text: "They raise demand on the grid.", sourceUrl: null },
    ]);
    expect(r.sources).toEqual([
      { name: "Texas Tribune", url: "https://www.texastribune.org/2026/data-centers/" },
      { name: "ERCOT", url: null },
    ]);
  });

  it("accepts a JSON string and fills missing arrays", () => {
    expect(parseExtraction(JSON.stringify({ tone: "angry", framing: " " }))).toEqual({
      tone: null,
      framing: null,
      entities: [],
      themes: [],
      arguments: [],
      sources: [],
    });
  });

  it("throws ExtractionParseError on bad JSON or the wrong shape", () => {
    expect(() => parseExtraction("{not json")).toThrow(ExtractionParseError);
    expect(() => parseExtraction({ entities: "ERCOT" })).toThrow(ExtractionParseError);
    expect(() => parseExtraction(null)).toThrow(ExtractionParseError);
  });
});

describe("citation rows", () => {
  it("maps provider sources in order with domains, skipping bad URLs", () => {
    const rows = providerCitationRows([
      { url: "https://www.ercot.com/news", title: "ERCOT", cited: true },
      { url: "::bad", title: null, cited: false },
      { url: "https://texastribune.org/x", title: null, cited: null },
    ]);
    expect(rows).toEqual([
      { url: "https://www.ercot.com/news", domain: "ercot.com", title: "ERCOT", cited: true, origin: "provider", position: 0 },
      { url: "https://texastribune.org/x", domain: "texastribune.org", title: null, cited: null, origin: "provider", position: 1 },
    ]);
  });

  it("adds sources found in the answer that the provider didn't report", () => {
    const result = parseExtraction(sample);
    const text = "See [ERCOT](https://www.ercot.com/news/) and https://puc.texas.gov/report.pdf, plus https://www.ercot.com/news#top.";
    const rows = extractedCitationRows(text, result, ["https://www.ercot.com/news"], 2);
    expect(rows).toEqual([
      { url: "https://www.texastribune.org/2026/data-centers/", domain: "texastribune.org", title: "Texas Tribune", cited: true, origin: "extracted", position: 2 },
      { url: "https://puc.texas.gov/report.pdf", domain: "puc.texas.gov", title: null, cited: true, origin: "extracted", position: 3 },
      { url: "https://example.com/tax", domain: "example.com", title: null, cited: true, origin: "extracted", position: 4 },
    ]);
  });
});

describe("extractionCreateData", () => {
  it("nests entities, themes and arguments and links sub-topics by id", () => {
    const result = parseExtraction(sample, SUB_TOPICS);
    const data = extractionCreateData(
      "ans1",
      result,
      { model: "gpt-6-luna", promptVersion: PROMPT_VERSION, inputTokens: 1000, outputTokens: 300, costUsd: 0.00025, priceIds: ["gpt-6-luna:input"], raw: sample },
      { "Power generation": "st_power" }
    );
    expect(data).toMatchObject({ answerId: "ans1", tone: "mixed", model: "gpt-6-luna", promptVersion: PROMPT_VERSION, costUsd: 0.00025 });
    expect(data.entities?.create).toHaveLength(3);
    expect(data.themes?.create).toEqual([
      expect.objectContaining({ normalized: "grid reliability", subTopicId: "st_power" }),
      expect.objectContaining({ normalized: "water use", subTopicId: null }),
      expect.objectContaining({ normalized: "jobs", subTopicId: null }),
    ]);
    expect(data.arguments?.create).toEqual([
      { side: "for", text: "Data centers bring tax revenue.", sourceUrl: "https://example.com/tax" },
      { side: "against", text: "They raise demand on the grid.", sourceUrl: null },
    ]);
  });
});

const askResult: AskResult = {
  provider: "claude",
  requestedModel: "claude-sonnet-5-5",
  modelRegistryId: "reg_claude",
  effortLevel: "medium",
  model: "claude-sonnet-5-5",
  question: "Are data centers raising electricity bills in Texas?",
  answer: "Partly. ERCOT says demand is rising (https://www.ercot.com/news).",
  sources: [{ url: "https://www.ercot.com/news", title: "ERCOT news", cited: true }],
  searchQueries: ["texas data centers electricity bills"],
  usage: { inputTokens: 5000, cachedInputTokens: 0, outputTokens: 600, reasoningTokens: 0, searchCalls: 2 },
  location: TEXAS_LOCATION,
  locationMode: "parameter",
  cost: { usd: 0.036, source: "computed", breakdown: { tokensUsd: 0.016, searchUsd: 0.02 }, priceIds: ["claude:search"] },
  finishReason: "end_turn",
  latencyMs: 12000,
};

describe("answer rows", () => {
  it("maps an AskResult to an Answer row", () => {
    expect(answerCreateData({ runId: "run1", question: askResult.question }, askResult)).toMatchObject({
      runId: "run1",
      questionId: null,
      repeat: 1,
      provider: "claude",
      modelRegistryId: "reg_claude",
      model: "claude-sonnet-5-5",
      answer: askResult.answer,
      locationCity: "Austin",
      locationMode: "parameter",
      inputTokens: 5000,
      searchCalls: 2,
      costUsd: 0.036,
      costSource: "computed",
      costSearchUsd: 0.02,
    });
  });

  it("maps a failed call with error fields and no answer", () => {
    const err = new ProviderError("gemini", "quota_exhausted", "quota", 429);
    const choice = { ...FREE_TIER_DEFAULTS.gemini, registryId: "reg_gemini", source: "registry" as const };
    const row = failedAnswerCreateData({ runId: "run1", question: "q" }, choice, err, null);
    expect(row).toMatchObject({
      provider: "gemini",
      modelRegistryId: "reg_gemini",
      requestedModel: FREE_TIER_DEFAULTS.gemini.model,
      errorKind: "quota_exhausted",
      errorStatus: 429,
      locationMode: "none",
    });
    expect(row.answer).toBeUndefined();
  });
});

/** A fake OpenAI Responses client returning `output` and recording requests. */
function fakeClient(output: unknown, usage = { input_tokens: 2000, output_tokens: 400 }) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    responses: {
      create: async (body: Record<string, unknown>) => {
        requests.push(body);
        return {
          status: "completed",
          model: "gpt-6-luna-2026-10-01",
          output_text: typeof output === "string" ? output : JSON.stringify(output),
          usage: { ...usage, input_tokens_details: { cached_tokens: 0 } },
        };
      },
    },
  } as unknown as ResponsesClient;
  return { client, requests };
}

describe("extractAnswer", () => {
  it("asks the extraction model for strict structured output and prices it", async () => {
    const { client, requests } = fakeClient(sample);
    const out = await extractAnswer(
      { topic: "Data centers in Texas", question: askResult.question, answer: askResult.answer, subTopics: SUB_TOPICS },
      { client }
    );
    expect(requests[0]).toMatchObject({
      model: EXTRACTION_MODEL,
      text: { format: { type: "json_schema", strict: true, schema: EXTRACTION_JSON_SCHEMA } },
    });
    expect(requests[0].tools).toBeUndefined();
    expect(out.result.tone).toBe("mixed");
    expect(out.promptVersion).toBe(PROMPT_VERSION);
    // 2,000 in × $0.10/1M + 400 out × $0.50/1M
    expect(out.costUsd).toBeCloseTo(0.0004, 8);
    expect(out.priceIds).toEqual(["gpt-6-luna:input", "gpt-6-luna:output"]);
  });

  it("reads the model from the model list's extraction row and records the row", async () => {
    const { client, requests } = fakeClient(sample);
    const settings = { ...EXTRACTION_DEFAULT, registryId: "reg-x", source: "registry" as const };
    const out = await extractAnswer({ topic: "T", question: "Q?", answer: "A." }, { client, settings });
    expect(requests[0]).toMatchObject({ model: EXTRACTION_DEFAULT.model, reasoning: { effort: "none" } });
    expect(out.modelRegistryId).toBe("reg-x");
    const data = extractionCreateData("ans1", out.result, out);
    expect(data).toMatchObject({ modelRegistryId: "reg-x" });
    expect((data.entities as { create: { canonicalName: string | null }[] }).create[0].canonicalName).toBe(
      "Electric Reliability Council of Texas"
    );
  });

  it("asks for each entity's full name in the schema", () => {
    const entity = EXTRACTION_JSON_SCHEMA.properties.entities.items;
    expect(entity.required).toContain("canonicalName");
  });

  it("passes the answer as quoted data", () => {
    const text = buildExtractionInput({ topic: "T", question: "Q?", answer: "A." });
    expect(text).toContain("<answer>\nA.\n</answer>");
    expect(text).toContain("<sub_topics>\n(none)\n</sub_topics>");
  });
});

/** Minimal in-memory stand-in for the Prisma calls the runner makes. */
function fakeDb() {
  const tables = { runs: [] as Record<string, unknown>[], answers: [] as Record<string, unknown>[], extractions: [] as Record<string, unknown>[], citations: [] as Record<string, unknown>[] };
  let id = 0;
  const db = {
    run: {
      create: async ({ data }: { data: Record<string, unknown> }) => (tables.runs.push({ id: `run${++id}`, ...data }), { id: `run${id}` }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(tables.runs[0], data),
    },
    answer: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `ans${++id}`, ...data };
        tables.answers.push(row);
        const nested = (data.citations as { create?: Record<string, unknown>[] } | undefined)?.create ?? [];
        tables.citations.push(...nested.map((c) => ({ ...c, answerId: row.id })));
        return { id: row.id };
      },
    },
    extraction: {
      create: async ({ data }: { data: Record<string, unknown> }) => (tables.extractions.push({ id: `ext${++id}`, ...data }), { id: `ext${id}` }),
    },
    citation: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => (tables.citations.push(...data), { count: data.length }),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(db),
  };
  return { db: db as unknown as PrismaClient, tables };
}

describe("runPipeline", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stores a run, one answer per provider and an extraction for every answered one", async () => {
    const asks: { question: string; model?: string }[] = [];
    vi.spyOn(PROVIDERS.claude, "ask").mockImplementation(
      async (question, opts) => (asks.push({ question, model: opts?.settings?.model }), askResult)
    );
    vi.spyOn(PROVIDERS.gemini, "ask").mockRejectedValue(new ProviderError("gemini", "quota_exhausted", "quota", 429));
    const { client } = fakeClient(sample);
    const { db, tables } = fakeDb();

    const result = await runPipeline(db, {
      kind: "manual",
      topic: "Data centers in Texas",
      questions: [{ text: askResult.question }],
      location: TEXAS_LOCATION,
      providers: ["claude", "gemini"],
      extractionClient: client,
    });

    // The provider gets the plain question (no JSON instructions) and the registry's model.
    expect(asks).toEqual([{ question: askResult.question, model: FREE_TIER_DEFAULTS.claude.model }]);
    expect(tables.answers[1]).toMatchObject({ provider: "gemini", requestedModel: FREE_TIER_DEFAULTS.gemini.model, errorKind: "quota_exhausted" });
    expect(tables.answers).toHaveLength(2);
    expect(tables.extractions).toHaveLength(1);
    expect(tables.extractions[0]).toMatchObject({ answerId: result.answers[0].answerId, tone: "mixed" });
    expect(tables.citations.map((c) => c.origin)).toEqual(["provider", "extracted", "extracted"]);
    expect(result.status).toBe("partial");
    expect(tables.runs[0]).toMatchObject({ status: "partial", askCity: "Austin" });
    expect(result.costUsd).toBeCloseTo(0.036 + 0.0004, 8);
  });

  it("stores a failed extraction row when the model's output can't be parsed", async () => {
    vi.spyOn(PROVIDERS.claude, "ask").mockResolvedValue(askResult);
    const { client } = fakeClient("{oops");
    const { db, tables } = fakeDb();
    const result = await runPipeline(db, { kind: "manual", topic: "T", providers: ["claude"], extractionClient: client });
    expect(tables.extractions).toEqual([expect.objectContaining({ errorMessage: expect.any(String), model: EXTRACTION_MODEL })]);
    expect(result.status).toBe("partial");
  });

  it("stores answers on an existing run when given one (a snapshot creates its run first)", async () => {
    vi.spyOn(PROVIDERS.claude, "ask").mockResolvedValue(askResult);
    const { client } = fakeClient(sample);
    const { db, tables } = fakeDb();
    tables.runs.push({ id: "snapshot1", status: "running" });
    const result = await runPipeline(db, { kind: "weekly", topic: "T", runId: "snapshot1", providers: ["claude"], extractionClient: client });
    expect(result.runId).toBe("snapshot1");
    expect(tables.runs).toHaveLength(1);
    expect(tables.answers[0]).toMatchObject({ runId: "snapshot1" });
    expect(tables.runs[0]).toMatchObject({ id: "snapshot1", status: "complete" });
  });
});
