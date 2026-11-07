import { geminiErrorBody } from "@/lib/ai-clients/gemini";

/**
 * The structured fields the provider SDKs put on their errors. Anthropic and
 * OpenAI errors carry `status`, `code` and the parsed body in `error`.
 * Gemini's ApiError carries `status` and the JSON body as its message, which
 * `geminiErrorBody` parses.
 */
interface ProviderErrorShape {
  status?: unknown;
  code?: unknown;
  error?: unknown;
}

/** Gemini's machine-readable failure reason (e.g. API_KEY_INVALID), if present. */
function geminiReason(err: unknown): string | null {
  for (const detail of geminiErrorBody(err)?.details ?? []) {
    const reason = (detail as { reason?: unknown } | null)?.reason;
    if (typeof reason === "string") return reason;
  }
  return null;
}

/** Categorize an error into a user-friendly reason */
export function categorizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("Timed out after")) return message;

  // Classify on the SDK's own status and error code before falling back to
  // message matching. Gemini's message is its raw JSON error body, which buries
  // the status past the 120-char display cut.
  const shaped = (typeof err === "object" && err !== null ? err : {}) as ProviderErrorShape;
  const status = typeof shaped.status === "number" ? shaped.status : null;
  const code = typeof shaped.code === "string" ? shaped.code : null;
  const reason = geminiReason(err);

  // A 429 for exhausted credit isn't a rate limit: it won't clear on retry and
  // needs billing attention, so name it separately.
  // xAI answers 402 when the team's prepaid credits run out.
  if (
    code === "insufficient_quota" ||
    status === 402 ||
    /credits? (?:are |is )?depleted|prepayment credits/i.test(message)
  )
    return "Quota exhausted — check the provider's billing";
  if (status === 401 || reason === "API_KEY_INVALID")
    return "Authentication error — invalid API key";
  if (status === 403)
    return "Permission denied — API key blocked or lacks access";
  if (status === 404) return "Model not found — check the model ID";
  if (status === 429) return "Rate limited — too many requests";

  // A provider's safety filter: Gemini's block or SAFETY-style finish reasons,
  // or Claude's refusal.
  if (
    /prompt blocked|finish reason: (?:SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII|RECITATION)|declined to analyze/i.test(
      message
    )
  )
    return "Blocked by the provider's safety filter";
  // OpenAI's content_filter and similar come back as a 200 with no text.
  if (message.includes("returned an empty answer"))
    return "Empty answer — possibly filtered by the provider";

  if (message.includes("429") || message.toLowerCase().includes("rate limit"))
    return "Rate limited — too many requests";
  if (message.includes("529") || message.includes("overloaded"))
    return "API overloaded — try again shortly";
  if (message.includes("401") || message.includes("authentication") || /invalid.*key/i.test(message))
    return "Authentication error — invalid API key";
  if (message.includes("403") || message.includes("permission"))
    return "Permission denied";
  if (message.includes("500") || message.includes("internal server error"))
    return "Provider API internal error";
  if (message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("fetch failed"))
    return "Network error — could not reach provider";
  if (message.includes("All") && message.includes("subtopic queries failed"))
    return "All subtopic queries failed";

  // A TypeError et al. never came from the provider's API — it's our own bug
  // handling a response. Report the detail, but don't put a raw JS message in
  // front of the user.
  if (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError
  )
    return "Could not process the provider's response";

  // Truncate long messages. For Gemini, show the API's own message rather
  // than the JSON body it arrives wrapped in.
  const trimmed = geminiErrorBody(err)?.message ?? message;
  return trimmed.length > 120 ? trimmed.slice(0, 120) + "…" : trimmed;
}

/**
 * `categorizeError` collapses a failure to one short line for display, which
 * throws away the detail that says *which* limit was hit. Pull the provider's
 * own diagnostics off the SDK error so the report is actionable — a 429 with a
 * `retry-after` is a rate limit that will clear, a 429 without one usually
 * means a quota or credit ceiling that won't.
 */
export function providerErrorDetail(err: unknown): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  if (typeof err !== "object" || err === null) return detail;

  const candidate = err as ProviderErrorShape & { headers?: unknown };

  if (typeof candidate.status === "number") detail.status = candidate.status;
  if (typeof candidate.code === "string") detail.code = candidate.code;
  const reason = geminiReason(err);
  if (reason) detail.reason = reason;

  // SDK errors carry a Headers instance; guard because the shape isn't declared.
  const headers = candidate.headers;
  if (headers && typeof (headers as Headers).get === "function") {
    const retryAfter =
      (headers as Headers).get("retry-after") ??
      (headers as Headers).get("retry-after-ms");
    if (retryAfter) detail.retryAfter = retryAfter;
  }

  // The parsed response body usually holds the provider's own explanation.
  const geminiMessage = geminiErrorBody(err)?.message;
  if (geminiMessage) detail.providerMessage = geminiMessage.slice(0, 300);
  const body = candidate.error;
  if (typeof body === "string") {
    detail.providerMessage = body.slice(0, 300);
  } else if (typeof body === "object" && body !== null) {
    const message = (body as { message?: unknown }).message;
    detail.providerMessage =
      typeof message === "string"
        ? message.slice(0, 300)
        : JSON.stringify(body).slice(0, 300);
  }

  return detail;
}
