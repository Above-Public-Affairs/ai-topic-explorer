import { describe, expect, it } from "vitest";
import { geminiErrorBody, isGeminiQuotaExhausted, providerErrorLabel, toProviderError } from "@/lib/answers/errors";
import { ProviderError } from "@/lib/answers/types";
import { anthropicError, geminiError, openaiError } from "./helpers/errors";

const openaiQuota = () =>
  openaiError(429, {
    error: {
      message: "You exceeded your current quota, please check your plan and billing details.",
      type: "insufficient_quota",
      code: "insufficient_quota",
    },
  });
const xaiCredits = () =>
  openaiError(402, {
    code: "Some resource has been exhausted",
    error: "Your team has either used all available credits or reached its monthly spending limit.",
  });

describe("toProviderError (provider interface)", () => {
  it.each([
    ["openai", openaiQuota(), "quota_exhausted", 429],
    ["grok", xaiCredits(), "quota_exhausted", 402],
    ["gemini", geminiError(429, "gemini-429-quota"), "quota_exhausted", 429],
    ["gemini", geminiError(429, "gemini-429-rate"), "rate_limited", 429],
    ["openai", openaiError(429, { error: { message: "Rate limit reached" } }), "rate_limited", 429],
    ["claude", anthropicError(401, "authentication_error", "invalid x-api-key"), "auth", 401],
    ["claude", anthropicError(403, "permission_error", "no access"), "auth", 403],
    ["gemini", geminiError(403, "gemini-403"), "auth", 403],
    ["claude", anthropicError(529, "overloaded_error", "Overloaded"), "unavailable", 529],
    ["gemini", geminiError(503, "gemini-503"), "unavailable", 503],
    ["claude", new Error("Claude declined to answer this question"), "blocked", null],
    ["gemini", new Error("Gemini returned no text (finish reason: PROHIBITED_CONTENT)"), "blocked", null],
    ["openai", Object.assign(new Error("This operation was aborted"), { name: "AbortError" }), "timeout", null],
    ["claude", new Error("Request timed out."), "timeout", null],
    ["grok", new TypeError("Cannot read properties of undefined"), "other", null],
  ] as const)("%s: %s → %s", (provider, err, kind, status) => {
    const typed = toProviderError(provider, err);
    expect(typed).toBeInstanceOf(ProviderError);
    expect(typed.provider).toBe(provider);
    expect(typed.kind).toBe(kind);
    expect(typed.status).toBe(status);
    expect(typed.cause).toBe(err);
  });

  it("writes a labelled message with the HTTP status and Gemini's own message", () => {
    const typed = toProviderError("gemini", geminiError(429, "gemini-429-quota"));
    expect(typed.message).toMatch(
      /^gemini: Quota exhausted — check the provider's billing \(HTTP 429\): You exceeded your current quota/
    );
  });

  it("caps the detail at 300 characters", () => {
    const typed = toProviderError("openai", new Error("y".repeat(1000)));
    expect(typed.message).toBe(`openai: Provider error: ${"y".repeat(300)}`);
  });

  it("passes an existing ProviderError through untouched", () => {
    const original = new ProviderError("grok", "rate_limited", "already typed", 429);
    expect(toProviderError("grok", original)).toBe(original);
  });

  it("applies Gemini's quota rule only to Gemini", () => {
    // The same body from another provider is a plain rate limit.
    expect(toProviderError("openai", geminiError(429, "gemini-429-quota")).kind).toBe("rate_limited");
  });
});

describe("isGeminiQuotaExhausted", () => {
  it("is true for a quota 429 with no RetryInfo", () => {
    expect(isGeminiQuotaExhausted(geminiError(429, "gemini-429-quota"))).toBe(true);
  });
  it("is false when RetryInfo names a wait", () => {
    expect(isGeminiQuotaExhausted(geminiError(429, "gemini-429-rate"))).toBe(false);
  });
  it("is false for a non-Gemini error", () => {
    expect(isGeminiQuotaExhausted(new Error("You exceeded your current quota"))).toBe(false);
  });
});

describe("geminiErrorBody", () => {
  it("reads the body out of a plain or stream error message", () => {
    expect(geminiErrorBody(geminiError(400, "gemini-400-bad-key", { stream: true }))?.message).toBe(
      "API key not valid. Please pass a valid API key."
    );
    expect(geminiErrorBody(geminiError(403, "gemini-403"))?.status).toBe("PERMISSION_DENIED");
  });
  it("is null for a non-Gemini error", () => {
    expect(geminiErrorBody(new Error("{}"))).toBeNull();
  });
});

describe("providerErrorLabel (shown on the public site)", () => {
  it.each([
    ["timeout", "Timed out"],
    ["rate_limited", "Rate limited — too many requests"],
    ["blocked", "Blocked by the provider's safety filter"],
  ] as const)("%s → %s", (kind, label) => {
    expect(providerErrorLabel(kind)).toBe(label);
  });
});
