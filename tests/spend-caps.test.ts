/**
 * Task 6.6: the spending-cap fixes from the code review (6.1) and the
 * security review (6.2). No database and no provider is reached: providers
 * are stubbed and Prisma is an in-memory fake.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

// Capture what the provider SDKs are sent (no network).
const sent = vi.hoisted(() => ({ claude: [] as Record<string, unknown>[], openai: [] as Record<string, unknown>[] }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      stream: (body: Record<string, unknown>) => {
        sent.claude.push(body);
        return {
          finalMessage: async () => ({
            model: "claude-sonnet-5-5",
            stop_reason: "end_turn",
            content: [{ type: "text", text: "An answer.", citations: [] }],
            usage: { input_tokens: 100, output_tokens: 20, server_tool_use: { web_search_requests: 2 } },
          }),
        };
      },
    };
  },
}));
vi.mock("openai", () => ({
  default: class {
    responses = {
      create: async (body: Record<string, unknown>) => {
        sent.openai.push(body);
        return { model: "gpt-6-luna", output: [], output_text: "An answer.", usage: { input_tokens: 100, output_tokens: 20 } };
      },
    };
  },
}));

import type { PrismaClient } from "@/app/generated/prisma/client";
import { PROVIDERS, ProviderError, type AskResult } from "@/lib/answers";
import { FAILED_CALL_ESTIMATE_USD, FAILED_EXTRACTION_ESTIMATE_USD, MAX_SEARCHES_PER_ANSWER, failedCallEstimateUsd } from "@/lib/answers/estimates";
import { computeCost } from "@/lib/answers/prices";
import { extractAndStore, type ResponsesClient } from "@/lib/extraction";
import { rateLimitSubject } from "@/lib/guards/client-ip";
import { runPipeline, type AnswerEvent } from "@/lib/pipeline/run";
import { spendGate, FIRST_CALL_ESTIMATE_USD } from "@/lib/snapshots/run";

const extractionOutput = {
  tone: "neutral",
  framing: "A framing.",
  entities: [],
  themes: [],
  arguments: [],
  citations: [],
};

function extractionClient(): ResponsesClient {
  return {
    responses: {
      create: async () => ({
        status: "completed",
        model: "gpt-6-luna",
        output_text: JSON.stringify(extractionOutput),
        usage: { input_tokens: 2000, output_tokens: 400, input_tokens_details: { cached_tokens: 0 } },
      }),
    },
  } as unknown as ResponsesClient;
}

const answer = (usd: number): AskResult => ({
  provider: "claude",
  requestedModel: "claude-sonnet-5-5",
  modelRegistryId: null,
  effortLevel: "medium",
  model: "claude-sonnet-5-5",
  question: "Q?",
  answer: "An answer.",
  sources: [],
  searchQueries: [],
  usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, searchCalls: 0 },
  location: null,
  locationMode: "none",
  cost: { usd, source: "computed", breakdown: { tokensUsd: usd, searchUsd: 0 }, priceIds: [] },
  finishReason: "end_turn",
  latencyMs: 1,
});

/** In-memory Prisma for the pipeline. `failAnswerWrites` makes answer.create throw for those providers. */
function fakeDb(opts: { failAnswerWrites?: string[]; failTransactions?: boolean } = {}) {
  const runs: Record<string, unknown>[] = [];
  const answers: Record<string, unknown>[] = [];
  const extractions: Record<string, unknown>[] = [];
  let id = 0;
  const db = {
    run: {
      create: async ({ data }: { data: Record<string, unknown> }) => (runs.push({ id: `run${++id}`, status: "running", ...data }), { id: `run${id}` }),
      update: async ({ data }: { data: Record<string, unknown> }) => Object.assign(runs[0], data),
    },
    answer: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (opts.failAnswerWrites?.includes(String(data.provider))) throw new Error("connection reset");
        const row = { id: `ans${++id}`, ...data };
        answers.push(row);
        return { id: row.id };
      },
      aggregate: async () => ({ _sum: { costUsd: answers.reduce((s, a) => s + Number(a.costUsd ?? 0), 0) } }),
    },
    extraction: {
      create: async ({ data }: { data: Record<string, unknown> }) => (extractions.push({ id: `ext${++id}`, ...data }), { id: `ext${id}` }),
      aggregate: async () => ({ _sum: { costUsd: extractions.reduce((s, e) => s + Number(e.costUsd ?? 0), 0) } }),
    },
    citation: { createMany: async ({ data }: { data: unknown[] }) => ({ count: data.length }) },
    $transaction: async (fn: (tx: unknown) => unknown) => {
      if (opts.failTransactions) throw new Error("deadlock detected");
      return fn(db);
    },
  };
  return { db: db as unknown as PrismaClient, runs, answers, extractions };
}

afterEach(() => vi.restoreAllMocks());

describe("runPipeline when a database write fails (code review M5)", () => {
  it("finishes the run, keeps the other calls, and counts the paid answer it couldn't store", async () => {
    vi.spyOn(PROVIDERS.claude, "ask").mockResolvedValue(answer(0.04));
    vi.spyOn(PROVIDERS.openai, "ask").mockResolvedValue({ ...answer(0.03), provider: "openai" });
    const { db, runs } = fakeDb({ failAnswerWrites: ["openai"] });
    const r = await runPipeline(db, { kind: "manual", topic: "T", providers: ["claude", "openai"], extractionClient: extractionClient() });
    expect(r.status).toBe("partial");
    expect(r.answers.find((a) => a.provider === "openai")).toMatchObject({ ok: false, answerCostUsd: 0.03, error: expect.stringMatching(/not stored/) });
    expect(r.costUsd).toBeCloseTo(0.04 + 0.03 + 0.0004, 6);
    expect(runs[0]).toMatchObject({ status: "partial", costUsd: expect.closeTo(0.0704, 6), finishedAt: expect.any(Date) });
  });
});

describe("failed calls count against the caps (security review L1)", () => {
  it("counts a call that failed after it was sent, and not one refused up front or never sent", () => {
    expect(failedCallEstimateUsd("timeout", true)).toBe(FAILED_CALL_ESTIMATE_USD);
    expect(failedCallEstimateUsd("blocked", true)).toBe(FAILED_CALL_ESTIMATE_USD);
    expect(failedCallEstimateUsd("unavailable", true)).toBe(FAILED_CALL_ESTIMATE_USD);
    expect(failedCallEstimateUsd("auth", true)).toBe(0);
    expect(failedCallEstimateUsd("rate_limited", true)).toBe(0);
    expect(failedCallEstimateUsd("timeout", false)).toBe(0);
  });

  it("stores the estimate on the failed answer, so the run's cost and spentSoFar include it", async () => {
    vi.spyOn(PROVIDERS.claude, "ask").mockRejectedValue(new ProviderError("claude", "unavailable", "overloaded mid-stream", 529));
    vi.spyOn(PROVIDERS.grok, "ask").mockRejectedValue(new ProviderError("grok", "auth", "bad key", 401));
    const { db, answers } = fakeDb();
    const r = await runPipeline(db, { kind: "public", topic: "T", providers: ["claude", "grok"] });
    expect(r.costUsd).toBeCloseTo(FAILED_CALL_ESTIMATE_USD, 8);
    expect(answers.find((a) => a.provider === "claude")).toMatchObject({ costUsd: FAILED_CALL_ESTIMATE_USD, costNote: expect.stringMatching(/estimate/) });
    expect(answers.find((a) => a.provider === "grok")?.costUsd).toBeUndefined();
  });

  it("costs a model with no price row at the highest listed price instead of throwing", () => {
    const cost = computeCost("openai", "gpt-unknown", { input: 1_000_000, output: 0, searches: 0 });
    expect(cost.usd).toBeGreaterThan(0);
    expect(cost.priceIds).toEqual(["fallback:input"]);
  });
});

describe("extraction cost when a write fails (code review L2, security review L1)", () => {
  const input = { topic: "T", question: "Q?" };
  const row = { id: "ans1", answer: "An answer.", providerUrls: [], nextCitationPosition: 0 };

  it("keeps the paid extraction's cost when its database write fails", async () => {
    const { db, extractions } = fakeDb({ failTransactions: true });
    const r = await extractAndStore(db, row, input, { client: extractionClient() });
    expect(r.ok).toBe(false);
    expect(r.costUsd).toBeCloseTo(0.0004, 8);
    expect(extractions[0]).toMatchObject({ costUsd: expect.closeTo(0.0004, 8), errorMessage: expect.stringMatching(/deadlock/) });
  });

  it("counts a failed extraction call at a small estimate rather than nothing", async () => {
    const { db } = fakeDb();
    const broken = { responses: { create: async () => Promise.reject(new Error("timed out")) } } as unknown as ResponsesClient;
    const r = await extractAndStore(db, row, input, { client: broken });
    expect(r).toMatchObject({ ok: false, costUsd: FAILED_EXTRACTION_ESTIMATE_USD });
  });
});

describe("snapshot spend gate (code review M2)", () => {
  const ok = (usd: number): AnswerEvent => ({ provider: "claude", question: "q", ok: true, result: answer(usd) });

  it("counts the fresh set and extractions, and stops before calls in flight could cross the cap", () => {
    const stop = new AbortController();
    const gate = spendGate(1, 0.4, stop);
    // $0.40 of fresh questions already spent; the first calls are planned at FIRST_CALL_ESTIMATE_USD each.
    const admitted = Math.floor((1 - 0.4) / FIRST_CALL_ESTIMATE_USD + 1e-9);
    for (let i = 0; i < admitted; i++) gate.beforeAsk();
    expect(stop.signal.aborted).toBe(false);
    gate.beforeAsk();
    expect(stop.signal.aborted).toBe(true);
    expect(gate.stopped()).toBe(true);
  });

  it("stops once answers plus extractions pass the cap", () => {
    const stop = new AbortController();
    const gate = spendGate(0.1, 0, stop);
    gate.beforeAsk();
    gate.onAnswer(ok(0.08));
    expect(stop.signal.aborted).toBe(false);
    gate.onExtracted(0.03);
    expect(stop.signal.aborted).toBe(true);
    expect(gate.spent()).toBeCloseTo(0.11);
  });

  it("counts a failed call's estimate, and nothing for one never sent", () => {
    const stop = new AbortController();
    const gate = spendGate(10, 0, stop);
    const error = new ProviderError("claude", "timeout", "aborted");
    gate.onAnswer({ provider: "claude", question: "q", ok: false, error, sent: true, estimatedCostUsd: 0.15 });
    gate.onAnswer({ provider: "claude", question: "q", ok: false, error, sent: false, estimatedCostUsd: 0 });
    expect(gate.spent()).toBeCloseTo(0.15);
  });

  it("caps a real pipeline run: no call starts that the cap can't cover", async () => {
    const ask = vi.spyOn(PROVIDERS.claude, "ask").mockResolvedValue(answer(0.05));
    const { db } = fakeDb();
    const stop = new AbortController();
    const gate = spendGate(0.2, 0, stop);
    await runPipeline(db, {
      kind: "weekly",
      topic: "T",
      questions: Array.from({ length: 20 }, (_, i) => ({ text: `q${i}` })),
      providers: ["claude"],
      askConcurrency: 12,
      signal: stop.signal,
      beforeAsk: gate.beforeAsk,
      onAnswer: gate.onAnswer,
      onExtracted: gate.onExtracted,
      extractionClient: extractionClient(),
    });
    // Before 6.6, all 12 slots started at once and the run ended near $0.60.
    expect(ask.mock.calls.length).toBeLessThanOrEqual(4);
    expect(gate.spent()).toBeLessThanOrEqual(0.2 + 1e-9);
  });
});

describe("rate limits key IPv6 by /64 (security review M1)", () => {
  it("counts addresses in one /64 together and keeps IPv4 as-is", () => {
    expect(rateLimitSubject("2001:db8:85a3:1:aaaa::1")).toBe("2001:db8:85a3:1::/64");
    expect(rateLimitSubject("2001:0db8:85a3:0001:ffff:ffff:ffff:fffe")).toBe("2001:db8:85a3:1::/64");
    expect(rateLimitSubject("2001:db8:85a3:2::1")).toBe("2001:db8:85a3:2::/64");
    expect(rateLimitSubject("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
    expect(rateLimitSubject("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitSubject("203.0.113.9")).toBe("203.0.113.9");
    expect(rateLimitSubject("unknown")).toBe("unknown");
  });
});

describe("searches per answer are bounded (security review M1)", () => {
  it("sets Claude's web_search max_uses and OpenAI's max_tool_calls", async () => {
    await PROVIDERS.claude.ask("Q?");
    await PROVIDERS.openai.ask("Q?");
    const tools = sent.claude[0].tools as { name: string; max_uses?: number }[];
    expect(tools[0]).toMatchObject({ name: "web_search", max_uses: MAX_SEARCHES_PER_ANSWER });
    expect(sent.openai[0]).toMatchObject({ max_tool_calls: MAX_SEARCHES_PER_ANSWER });
  });
});
