import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, BUG_REPORT_LIMIT } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/guards/client-ip";

const ERROR_API_URL = process.env.ERROR_API_URL;
const ERROR_API_KEY = process.env.ERROR_API_KEY;

const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_URL_LENGTH = 500;
const MAX_USER_AGENT_LENGTH = 500;
const MAX_TIMESTAMP_LENGTH = 40;
const FORWARD_TIMEOUT_MS = 8_000;

/** An optional string field, trimmed and cut to `max`, or null. */
function optionalField(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v ? v.slice(0, max) : null;
}

function fail(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers });
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed;
  } catch {
    return fail("Invalid request body", 400);
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  if (!description) return fail("Description is required", 400);
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return fail("Description too long", 400);
  }

  // Counted after validation, so malformed posts don't use up the allowance.
  // If the database is down, let the report through: a bug report is cheap,
  // and an outage is exactly when people want to send one.
  try {
    const limit = await checkRateLimit(getClientIp(request.headers), BUG_REPORT_LIMIT);
    if (!limit.allowed) {
      const retryMinutes = Math.max(1, Math.ceil((limit.retryAfterMs ?? 0) / 60000));
      return fail(
        `Too many reports. Try again in ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`,
        429,
        { "Retry-After": String(retryMinutes * 60) }
      );
    }
  } catch (e) {
    console.warn("[Bug report] Rate limit check failed, allowing report:", e);
  }

  if (!ERROR_API_URL || !ERROR_API_KEY) {
    console.error("[Bug report] ERROR_API_URL / ERROR_API_KEY not set; report not sent");
    return fail("Bug reporting is unavailable right now", 503);
  }

  try {
    const res = await fetch(ERROR_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": ERROR_API_KEY,
      },
      body: JSON.stringify({
        project: "ai-topic-explorer",
        category: "user_bug_report",
        message: description,
        context: {
          pageUrl: optionalField(body.pageUrl, MAX_URL_LENGTH),
          userAgent: optionalField(body.userAgent, MAX_USER_AGENT_LENGTH),
          reportedAt:
            optionalField(body.timestamp, MAX_TIMESTAMP_LENGTH) ??
            new Date().toISOString(),
          source: "bug_report_form",
        },
      }),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[Bug report] Forward failed: HTTP ${res.status}`);
      return fail("Your report couldn't be sent. Please try again later.", 502);
    }
  } catch (e) {
    console.error("[Bug report] Forward failed:", e);
    return fail("Your report couldn't be sent. Please try again later.", 502);
  }

  return NextResponse.json({ success: true });
}
