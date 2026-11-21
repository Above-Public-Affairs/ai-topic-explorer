import { describe, expect, it } from "vitest";
import { summarizeFailures } from "@/lib/pipeline/failures";
import type { RunPipelineResult } from "@/lib/pipeline/run";

type Answer = RunPipelineResult["answers"][number];
const ok = (provider: Answer["provider"], extraction: Answer["extraction"] = { extractionId: "x", ok: true, costUsd: 0 }): Answer => ({
  answerId: "a",
  provider,
  question: "q",
  ok: true,
  answerCostUsd: 0.01,
  extraction,
});
const failed = (provider: Answer["provider"], errorKind: Answer["errorKind"], error: string): Answer => ({
  answerId: "a",
  provider,
  question: "q",
  ok: false,
  answerCostUsd: 0,
  error,
  errorKind,
});

describe("summarizeFailures", () => {
  it("is empty when nothing failed", () => {
    const s = summarizeFailures([ok("claude"), ok("grok")]);
    expect(s).toEqual({ providers: [], extractionFailed: 0, headline: "" });
  });

  it("names the AI, the count and the error kind (the Nov 21 Grok case)", () => {
    const answers = [
      ...Array.from({ length: 8 }, () => ok("grok")),
      ...Array.from({ length: 24 }, () => failed("grok", "rate_limited", "rate_limited: 429 Your team has used all available credits")),
      ...Array.from({ length: 32 }, () => ok("claude")),
    ];
    const s = summarizeFailures(answers);
    expect(s.headline).toBe("Grok 24 of 32 calls failed (rate_limited)");
    expect(s.providers).toEqual([
      { provider: "grok", failed: 24, of: 32, kinds: { rate_limited: 24 }, sample: "rate_limited: 429 Your team has used all available credits" },
    ]);
  });

  it("lists the worst AI first, kinds by frequency, and counts failed extractions", () => {
    const s = summarizeFailures([
      failed("openai", "quota_exhausted", "quota_exhausted: 429 You have no credits remaining."),
      failed("openai", "quota_exhausted", "quota_exhausted: 429 You have no credits remaining."),
      failed("openai", "timeout", "timeout: aborted"),
      failed("gemini", undefined, "answer not stored: connection reset"),
      ok("claude", { extractionId: "", ok: false, costUsd: 0, error: "Extraction returned incomplete JSON" }),
    ]);
    expect(s.headline).toBe("ChatGPT 3 of 3 calls failed (quota_exhausted, timeout); Gemini 1 of 1 calls failed (not_stored); 1 extraction failed");
    expect(s.extractionSample).toBe("Extraction returned incomplete JSON");
  });

  it("keeps different causes apart once the Error Reporter folds the counts", () => {
    // The Error Reporter replaces numbers with <n>; what's left must differ by AI and kind.
    const fold = (m: string) => m.replace(/\b\d+\b/g, "<n>");
    const grok = summarizeFailures([failed("grok", "quota_exhausted", "x")]).headline;
    const openai = summarizeFailures([failed("openai", "quota_exhausted", "x"), ok("openai")]).headline;
    const grokRate = summarizeFailures([failed("grok", "rate_limited", "x"), ok("grok"), ok("grok")]).headline;
    expect(new Set([fold(grok), fold(openai), fold(grokRate)]).size).toBe(3);
  });
});
