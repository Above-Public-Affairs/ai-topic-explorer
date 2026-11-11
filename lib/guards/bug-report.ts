/**
 * Cleans a bug report from the public form before it's forwarded to the
 * Error Reporter (task 6.6, security review L3). Every field is written by
 * whoever posts, so nothing in the digest should be a link off-site or carry
 * control characters. The Error Reporter's digest escapes the message as HTML
 * and doesn't show the context (checked 2026-11-11), so this is the second
 * line of defence, not the only one.
 */

export const SITE_ORIGIN = "https://aitopicexplorer.app";

export const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_URL_LENGTH = 500;
const MAX_USER_AGENT_LENGTH = 500;

export interface CleanBugReport {
  description: string;
  pageUrl: string | null;
  userAgent: string | null;
  reportedAt: string;
}

/** Control characters other than tab and newline; also the bidi overrides used to disguise text. */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

function clean(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(CONTROL, "").trim();
}

function optional(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = clean(value).replace(/\s+/g, " ");
  return v ? v.slice(0, max) : null;
}

/**
 * Only a page on this site: the public origin, or the origin the request came
 * in on (the Railway domain, a local dev server). Anything else is dropped.
 */
export function sitePageUrl(value: unknown, requestOrigin: string | null): string | null {
  const raw = optional(value, MAX_URL_LENGTH);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const allowed = new Set([SITE_ORIGIN, ...(requestOrigin ? [requestOrigin] : [])]);
  if (!allowed.has(url.origin)) return null;
  return url.href;
}

/** A timestamp the browser sent, if it's a real ISO time; otherwise now. */
function reportedAt(value: unknown, now: Date): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(value.trim())) {
    const t = new Date(value.trim());
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  return now.toISOString();
}

/** The report to forward, or an error message for the visitor. */
export function cleanBugReport(body: Record<string, unknown>, requestOrigin: string | null, now = new Date()): { ok: true; report: CleanBugReport } | { ok: false; error: string } {
  const description = typeof body.description === "string" ? clean(body.description) : "";
  if (!description) return { ok: false, error: "Description is required" };
  if (description.length > MAX_DESCRIPTION_LENGTH) return { ok: false, error: "Description too long" };
  return {
    ok: true,
    report: {
      description,
      pageUrl: sitePageUrl(body.pageUrl, requestOrigin),
      userAgent: optional(body.userAgent, MAX_USER_AGENT_LENGTH),
      reportedAt: reportedAt(body.timestamp, now),
    },
  };
}
