import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@above-public-affairs/error-reporter";
import { checkRateLimit, ANALYZE_LIMIT } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/guards/client-ip";
import { MAX_TOPIC_LENGTH } from "@/lib/guards/limits";
import { reserveSpend, settleSpend } from "@/lib/guards/spend";

export type AnalyzeGuardResult =
  | { ok: true; topic: string; /** Held against the daily cap; settle it with settleSpend when the run ends. */ reservedUsd: number }
  | { ok: false; response: NextResponse };

function reject(error: string, status: number, headers?: HeadersInit): AnalyzeGuardResult {
  return { ok: false, response: NextResponse.json({ error }, { status, headers }) };
}

/**
 * Everything that must pass before an analysis spends money: the kill switch,
 * body validation, the daily spend cap and the per-IP rate limit. The body is
 * validated before the rate limit counts the request, so malformed requests
 * don't use up a visitor's allowance. Passing reserves part of the day's
 * budget (lib/guards/spend.ts); a request turned away after that gives it back.
 */
export async function guardAnalyzeRequest(
  request: NextRequest
): Promise<AnalyzeGuardResult> {
  if (process.env.ANALYSIS_ENABLED === "false") {
    return reject("Analysis is temporarily unavailable", 503);
  }

  let rawTopic: unknown;
  try {
    const body = await request.json();
    rawTopic = body?.topic;
  } catch {
    return reject("Invalid request body", 400);
  }
  if (typeof rawTopic !== "string" || rawTopic.trim().length === 0) {
    return reject("Please provide a topic to analyze", 400);
  }
  const topic = rawTopic.trim();
  if (topic.length > MAX_TOPIC_LENGTH) {
    return reject(`Topics can be up to ${MAX_TOPIC_LENGTH} characters`, 400);
  }

  let reservedUsd: number | null = null;
  try {
    reservedUsd = await reserveSpend();
    if (reservedUsd === null) {
      return reject(
        "Today's analysis budget has been used up. Please try again tomorrow.",
        503
      );
    }

    const limit = await checkRateLimit(getClientIp(request.headers), ANALYZE_LIMIT);
    if (!limit.allowed) {
      await settleSpend({ costUsd: 0, reservedUsd, analysis: false });
      // A visitor hitting the limit is the limiter working, not a fault, so
      // it's logged here rather than sent to the error digest.
      const retryMinutes = Math.max(1, Math.ceil((limit.retryAfterMs ?? 0) / 60000));
      console.log(`[Rate limit] analyze: limit hit, retry in ${retryMinutes} min`);
      return reject(
        `You've reached the analysis limit. Try again in ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`,
        429,
        { "Retry-After": String(retryMinutes * 60) }
      );
    }
  } catch (e) {
    if (reservedUsd) await settleSpend({ costUsd: 0, reservedUsd, analysis: false });
    // Without the database the limits can't be enforced and results can't be
    // saved, so refuse rather than run unmetered.
    console.error("[Guards] Database check failed:", e);
    reportError({
      project: "ai-topic-explorer",
      category: "database_error",
      message: "Rate limit / spend cap check failed",
      rawError: e,
    });
    return reject("Analysis is temporarily unavailable", 503);
  }

  return { ok: true, topic, reservedUsd };
}
