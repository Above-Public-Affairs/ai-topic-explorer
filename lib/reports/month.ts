/**
 * Which month a report covers, and whether an item has enough history for it.
 */
import type { ReportMonth } from "./types";

/** Weekly snapshots an item needs (through the month's end) before it goes in a report (PROJECT-PLAN §5A). */
export const MIN_WEEKLY_SNAPSHOTS = 4;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The month with this key ("2026-12"). */
export function monthFromKey(key: string): ReportMonth {
  const m = /^(\d{4})-(\d{2})$/.exec(key.trim());
  if (!m) throw new Error(`Month must look like 2026-12, got "${key}"`);
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  if (month < 0 || month > 11) throw new Error(`No month ${m[2]} in "${key}"`);
  return {
    key: `${m[1]}-${m[2]}`,
    label: `${MONTHS[month]} ${year}`,
    start: new Date(Date.UTC(year, month, 1)),
    end: new Date(Date.UTC(year, month + 1, 1)),
  };
}

/** The month before the one `now` falls in (UTC): the cron runs on the 1st for the month just ended. */
export function previousMonth(now: Date): ReportMonth {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return monthFromKey(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
}

/** Why an item stays out of this month's report, or null when it's ready. */
export function historySkipReason(weeklyCount: number, snapshotsInMonth: number, min = MIN_WEEKLY_SNAPSHOTS): string | null {
  if (weeklyCount < min) return `not enough history yet: ${weeklyCount} of ${min} weekly snapshots`;
  if (snapshotsInMonth === 0) return "no snapshots this month";
  return null;
}

/** The job key that makes a month's report go out once. */
export function reportJobKey(month: ReportMonth): string {
  return `report:monthly:${month.key}`;
}
