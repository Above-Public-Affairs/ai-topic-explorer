/**
 * The monthly health report (task 5.3, PROJECT-PLAN §5A). A Railway cron
 * service runs scripts/monthly-report.ts on the 1st of each month at 14:00
 * UTC for the month just ended.
 *
 * - Waits for history: an item goes in only once it has MIN_WEEKLY_SNAPSHOTS
 *   weekly snapshots through the month's end. With no item ready, the run
 *   logs "not enough history yet" and stops, before claiming the month.
 * - Off by default: REPORTS_ENABLED must be "true" to build and send.
 * - Once per month: the WatcherJob "report:monthly:<YYYY-MM>" is claimed
 *   before sending, so a re-run or a retry never sends twice.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { SendRejectedError, sendEmail, type EmailAttachment, type SendResult } from "@/lib/email/send";
import { claimJob, finishJob } from "@/lib/watchers/events/jobs";
import { buildItemReport } from "./aggregate";
import { itemCharts, type RenderedChart } from "./charts";
import { countWeekly, loadItemMonth } from "./load";
import { historySkipReason, previousMonth, reportJobKey } from "./month";
import { writeSummary } from "./summary";
import { renderHtml, renderText } from "./template";
import type { ItemMonthInput, MonthlyReport, ReportMonth, SkippedItem } from "./types";

export const DEFAULT_RECIPIENTS = ["joshua@abovepublicaffairs.com"];

export function recipientsFromEnv(value: string | undefined): string[] {
  const list = (value ?? "").split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
  for (const a of list) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a)) throw new Error(`REPORT_RECIPIENTS has an address that isn't one: "${a}"`);
  return list.length ? list : DEFAULT_RECIPIENTS;
}

export const enabledFromEnv = (value: string | undefined) => value?.trim().toLowerCase() === "true";

export interface BuiltReport {
  report: MonthlyReport;
  charts: { trend: RenderedChart }[];
  subject: string;
  html: string;
  text: string;
  attachments: EmailAttachment[];
}

export async function buildReport(
  month: ReportMonth,
  inputs: ItemMonthInput[],
  skipped: SkippedItem[],
  options: { sample?: boolean; summarize?: typeof writeSummary; now?: Date } = {}
): Promise<BuiltReport> {
  const sample = options.sample ?? false;
  const items = inputs.map(buildItemReport);
  const summarize = options.summarize ?? writeSummary;
  const summary = await summarize(items, skipped, sample ? `${month.label} (sample data)` : month.label);
  const report: MonthlyReport = { month, generatedAt: options.now ?? new Date(), sample, items, skipped, summary };
  const charts = items.map((r, i) => itemCharts(r, i, sample));
  const attachments = charts.map((c) => c.trend).map((c) => ({ filename: c.filename, type: "image/png", content: c.png, contentId: c.cid }));
  return {
    report,
    charts,
    subject: `${sample ? "[SAMPLE DATA] " : ""}What AI is saying: ${month.label}`,
    html: renderHtml(report, charts),
    text: renderText(report),
    attachments,
  };
}

export interface MonthlyOptions {
  now?: Date;
  month?: ReportMonth;
  enabled: boolean;
  recipients: string[];
  send?: typeof sendEmail;
  summarize?: typeof writeSummary;
  log?: (line: string) => void;
}

export type MonthlyOutcome =
  | { outcome: "skipped"; reason: string; month: ReportMonth; skipped: SkippedItem[] }
  | { outcome: "disabled"; month: ReportMonth; ready: string[]; skipped: SkippedItem[] }
  | { outcome: "sent"; month: ReportMonth; items: string[]; skipped: SkippedItem[]; send: SendResult; costUsd: number; summarySource: string };

/** Which items have enough history for the month, and why the others don't. */
export async function readiness(db: PrismaClient, month: ReportMonth): Promise<{ ready: { id: string; name: string }[]; skipped: SkippedItem[] }> {
  const items = await db.watchItem.findMany({
    where: { createdAt: { lt: month.end }, OR: [{ retiredAt: null }, { retiredAt: { gte: month.start } }] },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const ready: { id: string; name: string }[] = [];
  const skipped: SkippedItem[] = [];
  for (const item of items) {
    const [weekly, inMonth] = await Promise.all([
      countWeekly(db, item.id, month),
      db.run.count({ where: { watchItemId: item.id, kind: { in: ["weekly", "event"] }, status: { in: ["complete", "partial"] }, startedAt: { gte: month.start, lt: month.end } } }),
    ]);
    const reason = historySkipReason(weekly, inMonth);
    if (reason) skipped.push({ watchItemId: item.id, name: item.name, reason });
    else ready.push(item);
  }
  return { ready, skipped };
}

export async function runMonthlyReport(db: PrismaClient, options: MonthlyOptions): Promise<MonthlyOutcome> {
  const now = options.now ?? new Date();
  const month = options.month ?? previousMonth(now);
  const log = options.log ?? (() => {});
  const { ready, skipped } = await readiness(db, month);
  for (const s of skipped) log(`${s.name}: left out of ${month.label}, ${s.reason}`);

  if (!ready.length) {
    const reason = skipped.some((s) => s.reason.startsWith("not enough history")) ? "not enough history yet" : "no watch item has snapshots this month";
    log(`Monthly report for ${month.label}: skipped, ${reason}.`);
    return { outcome: "skipped", reason, month, skipped };
  }
  if (!options.enabled) {
    log(`Monthly report for ${month.label}: ${ready.length} item(s) ready, but REPORTS_ENABLED isn't "true", so nothing was built or sent.`);
    return { outcome: "disabled", month, ready: ready.map((r) => r.name), skipped };
  }

  const key = reportJobKey(month);
  const claim = await claimJob(db, key, "monthly_report", now);
  if (!claim.claimed) {
    log(`Monthly report for ${month.label}: skipped, ${claim.reason}.`);
    return { outcome: "skipped", reason: claim.reason, month, skipped };
  }
  let sending = false;
  try {
    const inputs = [];
    for (const item of ready) inputs.push(await loadItemMonth(db, item.id, month));
    const built = await buildReport(month, inputs, skipped, { summarize: options.summarize, now });
    sending = true;
    const send = await (options.send ?? sendEmail)(
      { to: options.recipients, subject: built.subject, text: built.text, html: built.html, attachments: built.attachments },
      { kind: "monthly-report" }
    );
    const costUsd = built.report.summary.costUsd;
    await finishJob(db, key, "complete", {
      costUsd,
      stats: { items: ready.map((r) => r.name), skipped, recipients: options.recipients.length, messageId: send.messageId, summary: built.report.summary.source, summaryNote: built.report.summary.note },
    });
    log(`Monthly report for ${month.label}: sent to ${options.recipients.length} recipient(s), ${ready.length} item(s), summary by ${built.report.summary.source}${built.report.summary.note ? ` (${built.report.summary.note})` : ""}, $${costUsd.toFixed(4)}.`);
    return { outcome: "sent", month, items: ready.map((r) => r.name), skipped, send, costUsd, summarySource: built.report.summary.source };
  } catch (err) {
    // No answer from SendGrid (timeout, network) may still mean it was sent: don't let a retry send it twice.
    const unknown = sending && !(err instanceof SendRejectedError);
    await finishJob(db, key, unknown ? "complete" : "failed", { note: `${unknown ? "send outcome unknown, not retried: " : ""}${String(err)}` }).catch(() => {});
    throw err;
  }
}
