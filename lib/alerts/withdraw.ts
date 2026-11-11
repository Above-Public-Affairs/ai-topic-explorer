/**
 * Withdrawn alerts (task 4.9). An alert found to be unreliable after the fact
 * (say its snapshot was missing an AI's answers) is kept for the record but
 * marked `withdrawn`, with the reason in its note. Anything that shows alerts
 * to people (the monthly report, a future alert email, the connector) reads
 * only REPORTED_ALERT_STATUSES, so a withdrawn alert never reaches anyone.
 */
import type { AlertStatus, PrismaClient } from "@/app/generated/prisma/client";

/** Matches lib/alerts/after-snapshot.ts (kept here so this module stays import-light for the connector's vendored copy). */
const STALE_SENDING_MS = 15 * 60 * 1000;

/** Alerts that were raised: sent, or stored while sending was off. Pending, in-flight, failed and withdrawn ones are left out. */
export const REPORTED_ALERT_STATUSES = ["sent", "suppressed"] as const satisfies readonly AlertStatus[];

export interface WithdrawResult {
  number: number;
  from: AlertStatus;
  outcome: "withdrawn" | "already withdrawn";
}

/** Mark alerts withdrawn by number, with the reason in the note. Rows stay; a re-run of the snapshot's alerts won't recreate them. */
export async function withdrawAlerts(db: PrismaClient, numbers: number[], reason: string): Promise<WithdrawResult[]> {
  if (!reason.trim()) throw new Error("Withdrawing an alert needs a reason for its note.");
  const rows = await db.alert.findMany({ where: { number: { in: numbers } }, select: { id: true, number: true, status: true, note: true, updatedAt: true } });
  const missing = numbers.filter((n) => !rows.some((r) => r.number === n));
  if (missing.length) throw new Error(`No such alert: ${missing.map((n) => `A-${n}`).join(", ")}`);
  const out: WithdrawResult[] = [];
  for (const r of rows.sort((a, b) => a.number - b.number)) {
    if (r.status === "withdrawn") {
      out.push({ number: r.number, from: r.status, outcome: "already withdrawn" });
      continue;
    }
    // A sending alert is mid-send; don't race the sender. One stuck in
    // "sending" (its process stopped) can be withdrawn (task 6.6, code review M4).
    const stale = r.status === "sending" && (!r.updatedAt || Date.now() - r.updatedAt.getTime() > STALE_SENDING_MS);
    if (r.status === "sending" && !stale) throw new Error(`A-${r.number} is being sent right now; try again in a minute.`);
    const from = r.status;
    const note = `Withdrawn ${new Date().toISOString().slice(0, 10)} (was ${from}): ${reason}${r.note ? ` | earlier note: ${r.note}` : ""}`.slice(0, 2000);
    await db.alert.update({ where: { id: r.id }, data: { status: "withdrawn", note } });
    out.push({ number: r.number, from, outcome: "withdrawn" });
  }
  return out;
}
