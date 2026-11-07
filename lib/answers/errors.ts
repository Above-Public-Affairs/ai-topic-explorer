import { ApiError } from "@google/genai";
import { ProviderError, type ProviderErrorKind, type ProviderId } from "./types";

/** The parsed `error` object of a Gemini API failure. */
export interface GeminiErrorBody {
  message?: string;
  status?: string;
  details: unknown[];
}

/**
 * The Gemini API's own error body. The SDK's ApiError carries only `status`
 * and a `message` holding the JSON response body (stream errors prefix it with
 * "got status: ..."), so the details have to be parsed back out of it.
 */
export function geminiErrorBody(err: unknown): GeminiErrorBody | null {
  if (!(err instanceof ApiError)) return null;
  const jsonStart = err.message.indexOf("{");
  if (jsonStart === -1) return null;
  try {
    const parsed = JSON.parse(err.message.slice(jsonStart)) as { error?: unknown };
    const body = parsed.error;
    if (typeof body !== "object" || body === null) return null;
    const { message, status, details } = body as Record<string, unknown>;
    return {
      message: typeof message === "string" ? message : undefined,
      status: typeof status === "string" ? status : undefined,
      details: Array.isArray(details) ? details : [],
    };
  } catch {
    return null;
  }
}

const LABELS: Record<ProviderErrorKind, string> = {
  quota_exhausted: "Quota exhausted — check the provider's billing",
  rate_limited: "Rate limited — too many requests",
  auth: "Authentication or access error",
  blocked: "Blocked by the provider's safety filter",
  unavailable: "Provider unavailable — try again shortly",
  timeout: "Timed out",
  other: "Provider error",
};

/**
 * Whether a Gemini 429 is an exhausted quota (billing, or a quota of zero such
 * as Search grounding on an unpaid project) rather than a short rate limit.
 * A rate limit names its wait in a RetryInfo detail; an exhausted quota
 * doesn't, and says "exceeded your current quota".
 */
export function isGeminiQuotaExhausted(err: unknown): boolean {
  const body = geminiErrorBody(err);
  if (!body) return false;
  const hasRetryDelay = body.details.some(
    (d) => typeof (d as { retryDelay?: unknown } | null)?.retryDelay === "string"
  );
  return !hasRetryDelay && /exceeded your current quota|check your plan and billing/i.test(body.message ?? "");
}

function classify(provider: ProviderId, err: unknown): { kind: ProviderErrorKind; status: number | null; detail: string } {
  const shaped = (typeof err === "object" && err !== null ? err : {}) as {
    status?: unknown;
    code?: unknown;
    name?: unknown;
  };
  const status = typeof shaped.status === "number" ? shaped.status : null;
  const code = typeof shaped.code === "string" ? shaped.code : null;
  const gemini = provider === "gemini" ? geminiErrorBody(err) : null;
  const detail = gemini?.message?.trim() || (err instanceof Error ? err.message : String(err));

  if (shaped.name === "AbortError" || /aborted|timed out/i.test(detail)) {
    return { kind: "timeout", status, detail };
  }
  if (
    code === "insufficient_quota" ||
    status === 402 ||
    (provider === "gemini" && status === 429 && isGeminiQuotaExhausted(err)) ||
    /credits? (?:are |is )?depleted|prepayment credits/i.test(detail)
  ) {
    return { kind: "quota_exhausted", status, detail };
  }
  if (status === 429) return { kind: "rate_limited", status, detail };
  if (status === 401 || status === 403 || gemini?.status === "PERMISSION_DENIED") {
    return { kind: "auth", status, detail };
  }
  if (status !== null && (status >= 500 || status === 529)) return { kind: "unavailable", status, detail };
  if (/declined to answer|prompt blocked|finish reason: (?:SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION)/i.test(detail)) {
    return { kind: "blocked", status, detail };
  }
  return { kind: "other", status, detail };
}

/**
 * The short reason shown to a visitor when a provider couldn't answer, e.g.
 * "Timed out" or "Rate limited — too many requests".
 */
export function providerErrorLabel(kind: ProviderErrorKind): string {
  return LABELS[kind];
}

/** Turn any failure from a provider call into a ProviderError. */
export function toProviderError(provider: ProviderId, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const { kind, status, detail } = classify(provider, err);
  const label = LABELS[kind];
  return new ProviderError(
    provider,
    kind,
    `${provider}: ${label}${status ? ` (HTTP ${status})` : ""}: ${detail.slice(0, 300)}`,
    status,
    { cause: err }
  );
}
