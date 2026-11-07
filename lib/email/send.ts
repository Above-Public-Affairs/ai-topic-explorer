/**
 * Outbound email (alerts and the monthly health report) via SendGrid's v3
 * mail/send API, the same account and sending domain Above's other tools use
 * (Agenda Briefings, Development Email Updates, the Error Reporter digest).
 * Plain `fetch`, no SDK, like those services.
 *
 * Config (Railway env, documented in .env.example):
 *   SENDGRID_API_KEY  required. 1Password: Development / "API Key - SendGrid General".
 *   SENDGRID_FROM     required. Any address on abovepublicaffairs.com, which is
 *                     domain-authenticated in SendGrid.
 *   SENDGRID_FROM_NAME optional, default "AI Topic Explorer".
 *   REPLY_TO          optional, default joshua@abovepublicaffairs.com. The From
 *                     address is send-only, so replies go to a real inbox.
 *
 * Keep this file free of `@/` imports: scripts load it directly under Node's
 * type stripping (`node scripts/send-test-email.ts`), which doesn't resolve them.
 */
import { reportError } from "@above-public-affairs/error-reporter";

const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_FROM_NAME = "AI Topic Explorer";
const DEFAULT_REPLY_TO = "joshua@abovepublicaffairs.com";

export interface OutgoingEmail {
  to: string | string[];
  subject: string;
  /** Plain-text fallback. Always required: some clients and filters read only this. */
  text: string;
  html?: string;
}

export interface SendOptions {
  timeoutMs?: number;
  /** Short label for error reports, e.g. "alert" or "monthly-report". */
  kind?: string;
}

/**
 * SendGrid answered and refused the message. A plain Error (timeout, network)
 * means no answer came back, so the message may still have been accepted;
 * callers deciding whether to retry should treat the two differently.
 */
export class SendRejectedError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SendRejectedError";
  }
}

export interface SendResult {
  /** SendGrid's X-Message-Id, for finding the message in its activity feed. */
  messageId: string | null;
  sentAt: Date;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function sendEmail(email: OutgoingEmail, options: SendOptions = {}): Promise<SendResult> {
  const recipients = (Array.isArray(email.to) ? email.to : [email.to]).map((a) => a.trim()).filter(Boolean);
  if (recipients.length === 0) throw new Error("sendEmail: no recipients");
  if (!email.text.trim()) throw new Error("sendEmail: plain-text body is required");

  const apiKey = requireEnv("SENDGRID_API_KEY");
  const from = requireEnv("SENDGRID_FROM");
  const kind = options.kind ?? "email";

  const content: Array<{ type: string; value: string }> = [{ type: "text/plain", value: email.text }];
  // SendGrid requires content in ascending richness: plain text, then HTML.
  if (email.html) content.push({ type: "text/html", value: email.html });

  const payload = {
    // One personalization per recipient so addresses never appear in each other's headers.
    personalizations: recipients.map((address) => ({ to: [{ email: address }] })),
    from: { email: from, name: process.env.SENDGRID_FROM_NAME?.trim() || DEFAULT_FROM_NAME },
    reply_to: { email: process.env.REPLY_TO?.trim() || DEFAULT_REPLY_TO },
    subject: email.subject,
    content,
  };

  // Error context carries counts, never addresses.
  const context = { kind, recipientCount: recipients.length };

  let response: Response;
  try {
    response = await fetch(SENDGRID_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    const message = `SendGrid request failed: ${cause instanceof Error ? cause.message : String(cause)}`;
    await reportError({ category: "email_error", operation: "sendEmail", message, rawError: cause, context });
    throw new Error(message, { cause });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message =
      `SendGrid send failed: ${response.status} ${response.statusText}` + (detail ? ` (${detail.slice(0, 500)})` : "");
    await reportError({
      category: "email_error",
      operation: "sendEmail",
      message,
      context: { ...context, status: response.status },
    });
    throw new SendRejectedError(message, response.status);
  }

  return { messageId: response.headers.get("x-message-id"), sentAt: new Date() };
}
