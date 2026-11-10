/**
 * Weekly snapshot worker (task 4.4): one snapshot per active watch item, then
 * exit. Runs as the Railway cron service "weekly-snapshots" (Monday 05:00 UTC);
 * see lib/worker/weekly.ts for the once-a-week guard and spending caps.
 *
 *   npm run worker:weekly
 *
 * Railway's start command is `node --import tsx scripts/weekly-snapshots.ts`,
 * not `npm run`: npm and the tsx CLI don't pass SIGTERM on, so the release
 * below would never run (task 4.9, LESSONS.md).
 *
 * Env: DATABASE_URL and the four AI keys (Railway references to the web
 * service), ERROR_API_URL / ERROR_API_KEY, optional WEEKLY_RUN_CAP_USD
 * (default 15, for the week's weekly runs together) and WEEKLY_ITEM_CAP_USD
 * (default 6, per item per week). Migrations stay with the web service.
 */
import { flush, initErrorReporter, reportError } from "@above-public-affairs/error-reporter";
import { prisma } from "@/lib/db";
import { DEFAULT_ITEM_CAP_USD, DEFAULT_RUN_CAP_USD, capFromEnv, runWeekly } from "@/lib/worker/weekly";
import { releaseOnSigterm } from "@/lib/worker/shutdown";

initErrorReporter({ project: "ai-topic-explorer" });

// A deploy SIGTERMs this container mid-run. Mark the snapshot in progress
// failed (with what it spent), so a re-run retries that item at once instead
// of waiting out the 3-hour "still running" window.
releaseOnSigterm("Weekly snapshots", prisma);

async function main(): Promise<number> {
  const runCapUsd = capFromEnv(process.env.WEEKLY_RUN_CAP_USD, DEFAULT_RUN_CAP_USD);
  const itemCapUsd = capFromEnv(process.env.WEEKLY_ITEM_CAP_USD, DEFAULT_ITEM_CAP_USD);
  const started = Date.now();
  console.log(`Weekly snapshots: run cap $${runCapUsd}, item cap $${itemCapUsd}`);

  const result = await runWeekly(prisma, {
    runCapUsd,
    itemCapUsd,
    snapshotOptions: { askConcurrency: 12 },
    log: (line) => console.log(line),
  });

  for (const item of result.items) {
    if (item.outcome === "failed") {
      reportError({
        category: "snapshot_error",
        message: `Weekly snapshot failed for ${item.name}: ${item.reason ?? "unknown error"}`,
        rawError: item.error,
        operation: "worker:weekly-snapshots",
        context: { watchItemId: item.watchItemId, calls: item.calls, failedCalls: item.failedCalls },
      });
    } else if (item.outcome === "ran" && (item.status !== "complete" || item.stoppedAtCapUsd || item.error)) {
      reportError({
        category: "snapshot_error",
        level: "warning",
        message: `Weekly snapshot for ${item.name} finished ${item.status}${item.stoppedAtCapUsd ? ` (stopped at $${item.stoppedAtCapUsd} cap)` : ""}${item.error ? `; comparison failed: ${String(item.error)}` : ""}`,
        rawError: item.error,
        operation: "worker:weekly-snapshots",
        context: { watchItemId: item.watchItemId, runId: item.runId, calls: item.calls, failedCalls: item.failedCalls, costUsd: item.costUsd },
      });
    } else if (item.outcome === "skipped" && item.reason?.startsWith("run spending cap")) {
      reportError({
        category: "snapshot_error",
        level: "warning",
        message: `Weekly snapshot skipped for ${item.name}: ${item.reason}`,
        operation: "worker:weekly-snapshots",
        context: { watchItemId: item.watchItemId },
      });
    }
  }

  const count = (o: string) => result.items.filter((i) => i.outcome === o).length;
  console.log(
    `Done in ${Math.round((Date.now() - started) / 1000)}s: ${count("ran")} ran, ${count("skipped")} skipped, ${count("failed")} failed, $${result.costUsd.toFixed(2)}${result.earlierUsd ? ` (+ $${result.earlierUsd.toFixed(2)} earlier this week)` : ""} of $${result.runCapUsd}`
  );
  return count("failed") > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err);
    reportError({ category: "crash", level: "fatal", message: `Weekly snapshot worker crashed: ${err instanceof Error ? err.message : String(err)}`, rawError: err, operation: "worker:weekly-snapshots" });
    process.exitCode = 1;
  })
  .finally(async () => {
    await flush();
    await prisma.$disconnect();
    // A cron service must exit, or Railway skips the next run.
    process.exit(process.exitCode ?? 0);
  });
