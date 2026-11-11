import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, BUG_REPORT_LIMIT } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/guards/client-ip";
import { cleanBugReport } from "@/lib/guards/bug-report";

const ERROR_API_URL = process.env.ERROR_API_URL;
const ERROR_API_KEY = process.env.ERROR_API_KEY;

const FORWARD_TIMEOUT_MS = 8_000;
/** A documentation-only address (RFC 5737), sent as X-Real-IP by the header check. */
const IP_CHECK_TEST_VALUE = "203.0.113.7";

function fail(error: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error }, { status, headers });
}

export async function POST(request: NextRequest) {
  // Opt-in check that Railway's edge replaces a client-sent X-Real-IP, which
  // the rate limits rely on (task 6.6). Logs yes/no answers only, never an
  // address. Send it with an empty description: the 400 below means nothing is
  // forwarded or counted.
  if (request.headers.get("x-ate-ip-check") === "1") {
    const realIp = request.headers.get("x-real-ip")?.trim() ?? "";
    const hops = (request.headers.get("x-forwarded-for") ?? "").split(",").map((h) => h.trim()).filter(Boolean);
    console.log(
      `[IP check] x-real-ip is the test value 203.0.113.7: ${realIp === IP_CHECK_TEST_VALUE}; ` +
        `x-real-ip matches the right-most forwarded hop: ${!!realIp && realIp === hops.at(-1)}; forwarded hops: ${hops.length}`
    );
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    body = parsed;
  } catch {
    return fail("Invalid request body", 400);
  }

  // Control characters stripped, off-site page URLs dropped, timestamp checked
  // (task 6.6, security review L3).
  const cleaned = cleanBugReport(body, request.nextUrl.origin);
  if (!cleaned.ok) return fail(cleaned.error, 400);
  const report = cleaned.report;

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
        message: report.description,
        context: {
          pageUrl: report.pageUrl,
          userAgent: report.userAgent,
          reportedAt: report.reportedAt,
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
