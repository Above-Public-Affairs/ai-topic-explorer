/**
 * Event watcher (task 4.7): the Railway cron service "event-watcher" runs
 * this every hour. Once a week it refreshes the known election and session
 * dates; once a day (from 12:00 UTC) it scans the web for events; every run
 * it gives due events a snapshot slot and runs the snapshots that are due.
 * See lib/watchers/events/worker.ts. Every step is claimed in WatcherJob, so
 * the run Railway starts on each deploy repeats nothing.
 *
 *   npm run worker:events
 *   npm run worker:events -- --force-scan            (scan now, still once a day)
 *   npm run worker:events -- --only=scan,schedule    (known,scan,schedule,snapshots)
 *
 * Env: DATABASE_URL and the AI keys (Railway references to the web service),
 * ERROR_API_URL / ERROR_API_KEY, optional EVENT_SCAN_CAP_USD (default 1, per
 * day's scan and per week's known-dates refresh), EVENT_SNAPSHOT_CAP_USD
 * (default 5, each event snapshot), EVENT_RUN_CAP_USD (default 15, all
 * snapshots in one run) and EVENT_SCAN_HOUR_UTC (default 12).
 * Migrations stay with the web service.
 */
import { flush, initErrorReporter, reportError } from "@above-public-affairs/error-reporter";
import { prisma } from "@/lib/db";
import { capFromEnv } from "@/lib/worker/weekly";
import { DEFAULT_RUN_CAP_USD, DEFAULT_SCAN_CAP_USD, DEFAULT_SCAN_HOUR_UTC, DEFAULT_SNAPSHOT_CAP_USD, abandonActiveJobs, runEventWatcher } from "@/lib/watchers/events";

initErrorReporter({ project: "ai-topic-explorer" });

const processStarted = new Date();
// Any deploy to the project replaces this container and SIGTERMs it mid-run.
// Give up this run's jobs as failed so the next hourly run retries them.
process.once("SIGTERM", () => {
  const reason = "stopped by SIGTERM (a deploy replaced the container)";
  console.log(`Event watcher: ${reason}; marking unfinished jobs failed`);
  abandonActiveJobs(prisma, reason, processStarted)
    .then((keys) => console.log(`  released: ${keys.join(", ") || "nothing"}`))
    .catch((err) => console.error(err))
    .finally(async () => {
      await flush();
      process.exit(1);
    });
});

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  return hit ? (hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true") : undefined;
}

async function main(): Promise<number> {
  const scanCapUsd = capFromEnv(process.env.EVENT_SCAN_CAP_USD, DEFAULT_SCAN_CAP_USD);
  const snapshotCapUsd = capFromEnv(process.env.EVENT_SNAPSHOT_CAP_USD, DEFAULT_SNAPSHOT_CAP_USD);
  const runCapUsd = capFromEnv(process.env.EVENT_RUN_CAP_USD, DEFAULT_RUN_CAP_USD);
  const hourEnv = process.env.EVENT_SCAN_HOUR_UTC?.trim();
  const scanHourUtc = hourEnv ? Number(hourEnv) : DEFAULT_SCAN_HOUR_UTC;
  if (!Number.isInteger(scanHourUtc) || scanHourUtc < 0 || scanHourUtc > 23) throw new Error(`EVENT_SCAN_HOUR_UTC must be 0–23, got "${hourEnv}"`);
  const only = arg("only")?.split(",").map((s) => s.trim());
  const stages = only
    ? { knownDates: only.includes("known"), scan: only.includes("scan"), schedule: only.includes("schedule"), snapshots: only.includes("snapshots") }
    : undefined;
  const started = Date.now();
  console.log(`Event watcher: scan cap $${scanCapUsd}, snapshot cap $${snapshotCapUsd}, run cap $${runCapUsd}, scan from ${scanHourUtc}:00 UTC`);

  const result = await runEventWatcher(prisma, {
    scanCapUsd,
    snapshotCapUsd,
    runCapUsd,
    scanHourUtc,
    forceScan: arg("force-scan") === "true",
    stages,
    snapshotOptions: { askConcurrency: 12 },
    log: (line) => console.log(line),
  });

  for (const stage of [result.knownDates, result.scan]) {
    for (const e of stage.logged) console.log(`  logged [${e.status}] ${e.category} ${e.occurredAt.slice(0, 10)} "${e.title}" — ${e.source}${e.note ? ` (${e.note})` : ""}`);
    if (!stage.ran && stage.reason) console.log(`  ${stage.reason}`);
  }
  for (const err of result.errors) {
    const warning = err.context?.level === "warning";
    reportError({
      category: err.stage === "snapshot" ? "snapshot_error" : "watcher_error",
      level: warning ? "warning" : "error",
      message: `Event watcher: ${err.message}`,
      rawError: err.error,
      operation: `worker:event-watcher:${err.stage}`,
      context: err.context,
    });
  }

  const ran = result.snapshots.filter((s) => s.outcome === "ran").length;
  console.log(
    `Done in ${Math.round((Date.now() - started) / 1000)}s: known dates ${result.knownDates.ran ? `$${result.knownDates.costUsd.toFixed(4)}` : "skipped"}, ` +
      `scan ${result.scan.ran ? `${result.scan.logged.length} new, $${result.scan.costUsd.toFixed(4)}` : "skipped"}, ` +
      `${result.scheduled.length} scheduled, ${ran} snapshots run, ${result.errors.length} errors, $${result.costUsd.toFixed(2)} total`
  );
  return result.errors.some((e) => e.context?.level !== "warning") ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err);
    reportError({ category: "crash", level: "fatal", message: `Event watcher crashed: ${err instanceof Error ? err.message : String(err)}`, rawError: err, operation: "worker:event-watcher" });
    process.exitCode = 1;
  })
  .finally(async () => {
    await flush();
    await prisma.$disconnect();
    // A cron service must exit, or Railway skips the next run.
    process.exit(process.exitCode ?? 0);
  });
