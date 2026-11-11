/**
 * Deploy-safe cron workers (tasks 4.7, 4.9). Every push to main redeploys all
 * Railway services, and Railway SIGTERMs a cron container that is mid-run.
 * Left alone, its "running" Run rows and WatcherJob claims block a retry until
 * their stale window passes. So each worker script calls releaseOnSigterm():
 * on SIGTERM it marks this process's unfinished work failed, so the next run
 * (scheduled, or started by hand) picks it up at once.
 *
 * Runs are tracked where they're created (runSnapshot, the model watcher's
 * switch runs) through ./active-runs.ts, a leaf module so lib/snapshots can
 * use it without an import cycle; WatcherJob claims in
 * lib/watchers/events/jobs.ts.
 *
 * The worker must be started as `node --import tsx scripts/<name>.ts`: npm and
 * the tsx CLI don't pass SIGTERM on, so the handler would never run.
 */
import { flush } from "@above-public-affairs/error-reporter";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { abandonActiveJobs } from "@/lib/watchers/events/jobs";
import { settleStaleSending } from "@/lib/alerts/after-snapshot";
import { spentSoFar, trackedRuns, trackedSending, untrackRun, untrackSending } from "./active-runs";

export { spentSoFar, trackRun, untrackRun, trackedRuns } from "./active-runs";

/**
 * Mark this process's runs that are still "running" failed, with what they
 * spent so far (so spending caps that count earlier runs still hold on the
 * retry). Returns the run ids it released.
 */
export async function releaseTrackedRuns(db: PrismaClient, reason: string): Promise<string[]> {
  const released: string[] = [];
  for (const id of trackedRuns()) {
    const costUsd = await spentSoFar(db, id);
    const n = await db.run.updateMany({
      where: { id, status: "running" },
      data: { status: "failed", finishedAt: new Date(), costUsd, note: reason.slice(0, 1000) },
    });
    if (n.count) released.push(id);
    untrackRun(id);
  }
  return released;
}

/**
 * Alerts this process was sending: the email may already be out, so they're
 * recorded as sent with an "outcome unknown" note, never resent (task 6.6,
 * code review M4).
 */
export async function releaseSendingAlerts(db: PrismaClient): Promise<string[]> {
  const ids = trackedSending();
  if (!ids.length) return [];
  await settleStaleSending(db, new Date(), ids);
  for (const id of ids) untrackSending(id);
  return ids;
}

/** Release this process's WatcherJob claims, runs and alerts mid-send. */
export async function releaseActiveWork(db: PrismaClient, reason: string, since: Date): Promise<{ jobs: string[]; runs: string[]; alerts: string[] }> {
  // Runs first: they're stored with what they spent, before the event watcher's own release marks its runs.
  const runs = await releaseTrackedRuns(db, reason);
  const jobs = await abandonActiveJobs(db, reason, since);
  const alerts = await releaseSendingAlerts(db);
  return { jobs, runs, alerts };
}

/** On SIGTERM, release this process's unfinished work, flush error reports and exit 1. */
export function releaseOnSigterm(name: string, db: PrismaClient): void {
  const since = new Date();
  process.once("SIGTERM", () => {
    const reason = "stopped by SIGTERM (a deploy replaced the container)";
    console.log(`${name}: ${reason}; marking unfinished work failed`);
    releaseActiveWork(db, reason, since)
      .then(({ jobs, runs, alerts }) => console.log(`  released: jobs ${jobs.join(", ") || "none"}; runs ${runs.join(", ") || "none"}; alerts mid-send ${alerts.join(", ") || "none"}`))
      .catch((err) => console.error(err))
      .finally(async () => {
        await flush();
        process.exit(1);
      });
  });
}
