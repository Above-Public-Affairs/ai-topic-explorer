/**
 * Each analyze-flow client, with its SDK replaced by a recorded response. No
 * network: the SDK classes below never reach a provider.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answer } from "./helpers/fixtures";

vi.mock("@above-public-affairs/error-reporter", () => ({ reportError: vi.fn() }));

const sdk = vi.hoisted(() => ({
  claudeStream: vi.fn(),
  openaiCreate: vi.fn(),
  grokCreate: vi.fn(),
  geminiGenerate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { stream: sdk.claudeStream };
  },
}));

// OpenAI and Grok share the openai SDK; Grok's client sets xAI's baseURL.
vi.mock("openai", () => ({
  default: class {
    chat: { completions: { create: typeof sdk.openaiCreate } };
    constructor(opts: { baseURL?: string }) {
      const create = opts.baseURL?.includes("x.ai") ? sdk.grokCreate : sdk.openaiCreate;
      this.chat = { completions: { create } };
    }
  },
}));

// Keep the real ApiError, enums and helpers; replace only the client.
vi.mock("@google/genai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@google/genai")>()),
  GoogleGenAI: class {
    models = { generateContent: sdk.geminiGenerate };
  },
}));

import { ApiError, BlockedReason, FinishReason } from "@google/genai";
import { reportError } from "@above-public-affairs/error-reporter";
import { analyzeWithClaude } from "@/lib/ai-clients/claude";
import { analyzeWithOpenAI } from "@/lib/ai-clients/openai";
import { analyzeWithGemini } from "@/lib/ai-clients/gemini";
import { analyzeWithGrok } from "@/lib/ai-clients/grok";

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(reportError).mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Anthropic stream events for `text`, in chunks, ending with `stopReason`. */
function claudeEvents(text: string, stopReason = "end_turn") {
  const chunks = text.match(/[\s\S]{1,200}/g) ?? [];
  return [
    { type: "message_start", message: { usage: { input_tokens: 120, output_tokens: 1 } } },
    ...chunks.map((t) => ({ type: "content_block_delta", delta: { type: "text_delta", text: t } })),
    { type: "message_delta", delta: { stop_reason: stopReason }, usage: { output_tokens: 900 } },
  ];
}

function streamOf(events: unknown[], failAfter?: number) {
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < events.length; i++) {
        if (failAfter !== undefined && i === failAfter) throw new Error("Request was aborted.");
        yield events[i];
      }
    },
  };
}

function chatCompletion(text: string, finish = "stop") {
  return {
    choices: [{ message: { content: text }, finish_reason: finish }],
    usage: { prompt_tokens: 100, completion_tokens: 800 },
  };
}

describe("analyzeWithClaude", () => {
  it("accumulates the stream and parses the block", async () => {
    sdk.claudeStream.mockReturnValueOnce(streamOf(claudeEvents(answer("clean"))));
    const r = await analyzeWithClaude("texas data centers");
    expect(r.provider).toBe("claude");
    expect(r.model).toBe("claude-sonnet-5-5");
    expect(r.entities.people[0].name).toBe("Greg Abbott");
    expect(r.citations).toHaveLength(2);
    expect(r.rawText).not.toContain("```");
    expect(r.usage).toEqual([{ inputTokens: 120, outputTokens: 900, purpose: "analysis" }]);
  });

  it("throws on a refusal instead of returning an empty success", async () => {
    sdk.claudeStream.mockReturnValueOnce(streamOf(claudeEvents("I can't help with that.", "refusal")));
    await expect(analyzeWithClaude("x")).rejects.toThrow("Claude declined to analyze this topic");
  });

  it("keeps partial text when the stream is cut off, and reports the lost block", async () => {
    const events = claudeEvents(answer("clean"));
    sdk.claudeStream.mockReturnValueOnce(streamOf(events, 3));
    const r = await analyzeWithClaude("x");
    expect(r.rawText.length).toBeGreaterThan(0);
    expect(r.entities.people).toEqual([]);
    expect(vi.mocked(reportError)).toHaveBeenCalledTimes(1);
  });

  it("rethrows when nothing streamed before the failure", async () => {
    sdk.claudeStream.mockReturnValueOnce(streamOf(claudeEvents(answer("clean")), 1));
    await expect(analyzeWithClaude("x")).rejects.toThrow("Request was aborted.");
  });
});

describe("analyzeWithOpenAI", () => {
  it("parses the completion text", async () => {
    sdk.openaiCreate.mockResolvedValueOnce(chatCompletion(answer("drifted")));
    const r = await analyzeWithOpenAI("x");
    expect(r.provider).toBe("openai");
    expect(r.model).toBe("gpt-6-luna");
    expect(r.entities.organizations).toEqual([{ name: "ERCOT" }]);
    expect(r.usage).toEqual([{ inputTokens: 100, outputTokens: 800, purpose: "analysis" }]);
  });

  it("reports a truncated answer (finish_reason length) and still returns its prose", async () => {
    sdk.openaiCreate.mockResolvedValueOnce(chatCompletion(answer("truncated"), "length"));
    const r = await analyzeWithOpenAI("x");
    expect(r.rawText).toBe("The answer ran out of tokens part-way through the JSON block.");
    expect(vi.mocked(reportError).mock.calls[0][0]).toMatchObject({
      provider: "openai",
      context: { kind: "unclosed_block" },
    });
  });
});

describe("analyzeWithGrok", () => {
  it("parses quoted phrases, clamping frequency and dropping malformed ones", async () => {
    sdk.grokCreate.mockResolvedValueOnce(chatCompletion(answer("grok")));
    const r = await analyzeWithGrok("x");
    expect(r.provider).toBe("grok");
    expect(r.entities.organizations).toEqual([{ name: "xAI" }]);
    expect(r.quotedPhrases).toEqual([
      { phrase: "Data centers get cheap power while my bill doubles every summer", frequency: 5 },
      { phrase: "Texas is open for business and the grid can handle it", frequency: 5 },
      // 0 is falsy, so `frequency || 3` reads it as missing.
      { phrase: "Where is all the water coming from for these cooling towers", frequency: 3 },
      { phrase: "No frequency given for this one but it still counts", frequency: 3 },
    ]);
  });

  it("omits quotedPhrases when the block has none", async () => {
    sdk.grokCreate.mockResolvedValueOnce(chatCompletion(answer("clean")));
    const r = await analyzeWithGrok("x");
    expect(r).not.toHaveProperty("quotedPhrases");
  });
});

describe("analyzeWithGemini", () => {
  const ok = (text: string) => ({
    text,
    candidates: [{ finishReason: FinishReason.STOP }],
    usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 700 },
  });
  const busy = () =>
    new ApiError({
      status: 503,
      message: JSON.stringify({ error: { code: 503, message: "The model is overloaded.", status: "UNAVAILABLE" } }),
    });

  it("parses the response text", async () => {
    sdk.geminiGenerate.mockResolvedValueOnce(ok(answer("unfenced")));
    const r = await analyzeWithGemini("x");
    expect(r.model).toBe("gemini-3.6-flash");
    expect(r.entities.people).toEqual([{ name: "Greg Abbott" }]);
    expect(r.usage).toEqual([{ inputTokens: 90, outputTokens: 700, purpose: "analysis" }]);
  });

  it("throws on a blocked prompt instead of returning an empty success", async () => {
    sdk.geminiGenerate.mockResolvedValueOnce({ text: undefined, promptFeedback: { blockReason: BlockedReason.SAFETY } });
    await expect(analyzeWithGemini("x")).rejects.toThrow("Gemini returned no text (prompt blocked: SAFETY)");
  });

  it("throws on a SAFETY finish with no text", async () => {
    sdk.geminiGenerate.mockResolvedValueOnce({ text: undefined, candidates: [{ finishReason: FinishReason.SAFETY }] });
    await expect(analyzeWithGemini("x")).rejects.toThrow("finish reason: SAFETY");
  });

  it("retries a 503, then falls back and records the model that answered", async () => {
    vi.useFakeTimers();
    sdk.geminiGenerate
      .mockRejectedValueOnce(busy())
      .mockRejectedValueOnce(busy())
      .mockRejectedValueOnce(busy())
      .mockResolvedValueOnce(ok(answer("clean")));
    const pending = analyzeWithGemini("x");
    await vi.runAllTimersAsync();
    const r = await pending;
    expect(sdk.geminiGenerate).toHaveBeenCalledTimes(4);
    expect(sdk.geminiGenerate.mock.calls[3][0].model).toBe("gemini-3.5-flash-lite");
    expect(r.model).toBe("gemini-3.5-flash-lite");
  });

  it("doesn't retry a 400", async () => {
    sdk.geminiGenerate.mockReset();
    sdk.geminiGenerate.mockRejectedValueOnce(
      new ApiError({ status: 400, message: JSON.stringify({ error: { code: 400, message: "Bad request" } }) })
    );
    await expect(analyzeWithGemini("x")).rejects.toBeInstanceOf(ApiError);
    expect(sdk.geminiGenerate).toHaveBeenCalledTimes(1);
  });
});
