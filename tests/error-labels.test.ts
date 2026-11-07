import { describe, expect, it } from "vitest";
import { categorizeError, providerErrorDetail } from "@/lib/analysis/provider-errors";
import { isGeminiQuotaExhausted, toProviderError } from "@/lib/answers/errors";
import { ProviderError } from "@/lib/answers/types";
import { anthropicError, geminiError, openaiError } from "./helpers/errors";

const QUOTA = "Quota exhausted — check the provider's billing";
const RATE = "Rate limited — too many requests";
const AUTH = "Authentication error — invalid API key";

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

describe("categorizeError (analyze flow)", () => {
  it.each([
    ["OpenAI insufficient_quota 429", openaiQuota(), QUOTA],
    ["xAI 402 out of credits", xaiCredits(), QUOTA],
    ["a 'credits are depleted' message", new Error("Your prepaid credits are depleted"), QUOTA],
    ["OpenAI plain 429", openaiError(429, { error: { message: "Rate limit reached", code: "rate_limit_exceeded" } }), RATE],
    ["Anthropic 401", anthropicError(401, "authentication_error", "invalid x-api-key"), AUTH],
    ["Gemini API_KEY_INVALID (a 400)", geminiError(400, "gemini-400-bad-key"), AUTH],
    ["Anthropic 403", anthropicError(403, "permission_error", "nope"), "Permission denied — API key blocked or lacks access"],
    ["Gemini 403", geminiError(403, "gemini-403"), "Permission denied — API key blocked or lacks access"],
    ["OpenAI 404", openaiError(404, { error: { message: "The model `gpt-x` does not exist" } }), "Model not found — check the model ID"],
    ["Gemini 429 with RetryInfo", geminiError(429, "gemini-429-rate"), RATE],
    // The analyze flow has no grounding, so it doesn't split Gemini's quota 429 out.
    ["Gemini 429 quota (no RetryInfo)", geminiError(429, "gemini-429-quota"), RATE],
    ["Anthropic 529 overloaded", anthropicError(529, "overloaded_error", "Overloaded"), "API overloaded — try again shortly"],
    ["Anthropic 500", anthropicError(500, "api_error", "Internal server error"), "Provider API internal error"],
    ["Gemini prompt blocked", new Error("Gemini returned no text (prompt blocked: SAFETY)"), "Blocked by the provider's safety filter"],
    ["Gemini SAFETY finish", new Error("Gemini returned no text (finish reason: SAFETY)"), "Blocked by the provider's safety filter"],
    ["Claude refusal", new Error("Claude declined to analyze this topic"), "Blocked by the provider's safety filter"],
    ["empty answer", new Error("openai returned an empty answer"), "Empty answer — possibly filtered by the provider"],
    ["fetch failed", new TypeError("fetch failed"), "Network error — could not reach provider"],
    ["ENOTFOUND", new Error("getaddrinfo ENOTFOUND api.x.ai"), "Network error — could not reach provider"],
    ["all subtopics failed", new Error("All 4 subtopic queries failed"), "All subtopic queries failed"],
    ["our own TypeError", new TypeError("Cannot read properties of undefined (reading 'url')"), "Could not process the provider's response"],
  ])("%s", (_label, err, expected) => {
    expect(categorizeError(err)).toBe(expected);
  });

  it("passes a timeout message through as-is", () => {
    expect(categorizeError(new Error("Timed out after 150s (claude: water)"))).toBe("Timed out after 150s (claude: water)");
  });

  it("shows Gemini's own message, not its JSON body, for an unclassified error", () => {
    expect(categorizeError(geminiError(400, "gemini-400-invalid"))).toBe(
      "* GenerateContentRequest.contents: contents is not specified"
    );
  });

  it("labels Gemini's 503 overload from its message", () => {
    expect(categorizeError(geminiError(503, "gemini-503"))).toBe("API overloaded — try again shortly");
  });

  it("cuts long messages to 120 characters", () => {
    const label = categorizeError(new Error("x".repeat(500)));
    expect(label).toBe("x".repeat(120) + "…");
  });

  it("handles non-Error throws", () => {
    expect(categorizeError("rate limit hit")).toBe(RATE);
  });
});

describe("providerErrorDetail", () => {
  it("pulls status, code, retry-after and the provider's message off an OpenAI error", () => {
    const err = openaiError(
      429,
      { error: { message: "Rate limit reached for gpt-6-luna", code: "rate_limit_exceeded" } },
      { "retry-after": "20" }
    );
    expect(providerErrorDetail(err)).toEqual({
      status: 429,
      code: "rate_limit_exceeded",
      retryAfter: "20",
      providerMessage: "Rate limit reached for gpt-6-luna",
    });
  });

  it("reads Gemini's reason and message out of its JSON body", () => {
    expect(providerErrorDetail(geminiError(400, "gemini-400-bad-key", { stream: true }))).toEqual({
      status: 400,
      reason: "API_KEY_INVALID",
      providerMessage: "API key not valid. Please pass a valid API key.",
    });
  });

  it("keeps xAI's string error body", () => {
    expect(providerErrorDetail(xaiCredits()).providerMessage).toMatch(/used all available credits/);
  });

  it("returns nothing for a non-object", () => {
    expect(providerErrorDetail("boom")).toEqual({});
  });
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
