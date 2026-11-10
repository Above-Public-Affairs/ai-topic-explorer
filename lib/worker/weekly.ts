/**
 * The weekly snapshot worker (task 4.4, PROJECT-PLAN §4D). A Railway cron
 * service runs scripts/weekly-snapshots.ts every Monday 05:00 UTC (Sunday
 * 11pm Central in winter, midnight in summer): one snapshot per active watch
 * item, then exit.
 *
 * - Once a week: an item with a complete or partial weekly snapshot this week
 *   (weeks start Monday 00:00 UTC), or one still running, is skipped. A failed
 *   one doesn't count, so a re-run retries it.
 * - One item failing never stops the others.
 * - A spending cap for the whole run (WEEKLY_RUN_CAP_USD, default $15) is
 *   shared across items: each snapshot gets at most what's left, up to its own
 *   cap (WEEKLY_ITEM_CAP_USD, default $6). Below $1 left, the rest are skipped.
 * - Once a previous snapshot exists, the new one's comparison against it goes
 *   on Run.stats.comparison, then afterSnapshot() makes its alerts (5.2).
 */
import { Prisma, type PrismaClient, type RunStatus } from "@/app/generated/prisma/client";
import { compareRuns, runSnapshot, type RunSnapshotOptions, type RunSnapshotResult, type SnapshotStats } from "@/lib/snapshots";
import { afterSnapshot } from "@/lib/alerts";

export const DEFAULT_RUN_CAP_USD = 15;
export const DEFAULT_ITEM_CAP_USD = 6;
/** Don't start a snapshot with less than this left under the run cap. */
export const MIN_ITEM_BUDGET_USD = 1;
/** A snapshot "running" longer than this was orphaned (the process died); it no longer blocks the week. */
export const STALE_RUNNING_MS = 3 * 60 * 60 * 1000;

/** Start of the week (Monday 00:00 UTC) that `now` falls in. */
export function weekStart(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysSinceMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

export interface ExistingRun {
  id: string;
  status: RunStatus;
  startedAt: Date;
}

/** Why an item should be skipped this week, or null to run it. `runs` are this item's weekly runs since weekStart(now). */
export function weeklySkipReason(runs: ExistingRun[], now: Date): string | null {
  const since = weekStart(now).getTime();
  for (const r of runs) {
    if (r.startedAt.getTime() < since) continue;
    if (r.status === "complete" || r.status === "partial") return `already has a ${r.status} snapshot this week (${r.id})`;
    if (r.status === "running" && now.getTime() - r.startedAt.getTime() < STALE_RUNNING_MS) return `a snapshot is still running (${r.id})`;
  }
  return null;
}

/** Positive dollar amount from an env var, or the default. */
export function capFromEnv(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Spending cap must be a positive number of dollars, got "${value}"`);
  return n;
}

export interface ItemOutcome {
  watchItemId: string;
  name: string;
  outcome: "ran" | "skipped" | "failed";
  reason?: string;
  runId?: string;
  status?: RunStatus;
  questions?: number;
  calls?: number;
  failedCalls?: number;
  costUsd?: number;
  held?: number;
  noisy?: number;
  stoppedAtCapUsd?: number;
  comparedWith?: string;
  swings?: number;
  error?: unknown;
}

export interface WeeklyOptions {
  now?: Date;
  runCapUsd?: number;
  itemCapUsd?: number;
  /** Swappable for tests. */
  snapshot?: (db: PrismaClient, watchItemId: string, options: RunSnapshotOptions) => Promise<RunSnapshotResult>;
  compare?: typeof compareRuns;
  alerts?: typeof afterSnapshot;
  snapshotOptions?: Omit<RunSnapshotOptions, "kind" | "maxCostUsd">;
  log?: (line: string) => void;
}

export interface WeeklyResult {
  items: ItemOutcome[];
  costUsd: number;
  runCapUsd: number;
}

export async function runWeekly(db: PrismaClient, options: WeeklyOptions = {}): Promise<WeeklyResult> {
  const now = options.now ?? new Date();
  const runCapUsd = options.runCapUsd ?? DEFAULT_RUN_CAP_USD;
  const itemCapUsd = options.itemCapUsd ?? DEFAULT_ITEM_CAP_USD;
  const snapshot = options.snapshot ?? runSnapshot;
  const compare = options.compare ?? compareRuns;
  const log = options.log ?? (() => {});

  const items = await db.watchItem.findMany({
    where: { active: true, retiredAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const since = weekStart(now);
  const outcomes: ItemOutcome[] = [];
  let spent = 0;

  for (const item of items) {
    const existing = await db.run.findMany({
      where: { watchItemId: item.id, kind: "weekly", startedAt: { gte: since } },
      select: { id: true, status: true, startedAt: true },
    });
    const skip = weeklySkipReason(existing, now);
    if (skip) {
      outcomes.push({ watchItemId: item.id, name: item.name, outcome: "skipped", reason: skip });
      log(`${item.name}: skipped, ${skip}`);
      continue;
    }
    const left = runCapUsd - spent;
    if (left < MIN_ITEM_BUDGET_USD) {
      const reason = `run spending cap $${runCapUsd} reached ($${spent.toFixed(2)} spent)`;
      outcomes.push({ watchItemId: item.id, name: item.name, outcome: "skipped", reason });
      log(`${item.name}: skipped, ${reason}`);
      continue;
    }

    const itemStarted = new Date();
    let calls = 0;
    let failedCalls = 0;
    try {
      const result = await snapshot(db, item.id, {
        ...options.snapshotOptions,
        kind: "weekly",
        maxCostUsd: Math.min(itemCapUsd, left),
        note: "weekly worker",
        onAnswer: (e) => {
          calls++;
          if (!e.ok) failedCalls++;
          options.snapshotOptions?.onAnswer?.(e);
        },
      });
      spent += result.costUsd;
      const outcome = summarize(item, result, calls, failedCalls);

      // Compare against the previous snapshot of this item, when there is one.
      const previous = await db.run.findFirst({
        where: { watchItemId: item.id, id: { not: result.runId }, status: { in: ["complete", "partial"] }, stats: { not: Prisma.AnyNull }, startedAt: { lt: itemStarted } },
        orderBy: { startedAt: "desc" },
        select: { id: true, stats: true },
      });
      let stats: SnapshotStats = result.stats;
      if (previous?.stats) {
        try {
          const comparison = await compare(db, previous.id, result.runId);
          stats = { ...stats, comparison: { againstRunId: previous.id, ...comparison } };
          outcome.comparedWith = previous.id;
          outcome.swings = comparison.swings.length;
        } catch (err) {
          outcome.error = err;
          log(`${item.name}: comparison against ${previous.id} failed: ${String(err)}`);
        }
      }
      const note = `weekly worker: ${calls} calls, ${failedCalls} failed${result.stats.stoppedAtCapUsd ? `, stopped at $${result.stats.stoppedAtCapUsd} cap` : ""}`;
      await db.run.update({ where: { id: result.runId }, data: { stats: JSON.parse(JSON.stringify(stats)), note } });
      await (options.alerts ?? afterSnapshot)(db, result.runId, { log: (l) => log(`${item.name}: ${l}`) });
      outcomes.push(outcome);
      log(summaryLine(outcome));
    } catch (err) {
      // runSnapshot marks a run failed when its questions fail; anything that threw later leaves it "running".
      await db.run
        .updateMany({
          where: { watchItemId: item.id, kind: "weekly", status: "running", startedAt: { gte: itemStarted } },
          data: { status: "failed", finishedAt: new Date(), note: `weekly worker: ${String(err)}`.slice(0, 1000) },
        })
        .catch(() => {});
      const outcome: ItemOutcome = { watchItemId: item.id, name: item.name, outcome: "failed", reason: String(err), calls, failedCalls, error: err };
      outcomes.push(outcome);
      log(`${item.name}: FAILED after ${calls} calls: ${String(err)}`);
    }
  }
  return { items: outcomes, costUsd: spent, runCapUsd };
}

function summarize(item: { id: string; name: string }, result: RunSnapshotResult, calls: number, failedCalls: number): ItemOutcome {
  const totals = Object.values(result.stats.agreement.totals);
  return {
    watchItemId: item.id,
    name: item.name,
    outcome: "ran",
    runId: result.runId,
    status: result.pipeline.status,
    questions: new Set(result.pipeline.answers.map((a) => a.question)).size,
    calls,
    failedCalls,
    costUsd: result.costUsd,
    held: totals.reduce((n, t) => n + t.held, 0),
    noisy: totals.reduce((n, t) => n + t.noisy, 0),
    stoppedAtCapUsd: result.stats.stoppedAtCapUsd,
  };
}

/** One line per item for the logs. */
export function summaryLine(o: ItemOutcome): string {
  if (o.outcome !== "ran") return `${o.name}: ${o.outcome}${o.reason ? `, ${o.reason}` : ""}`;
  return [
    `${o.name}: ${o.status} (run ${o.runId})`,
    `${o.questions} questions`,
    `${o.calls} calls`,
    `${o.failedCalls} failed`,
    `$${(o.costUsd ?? 0).toFixed(2)}`,
    `${o.held} held / ${o.noisy} noisy`,
    o.comparedWith ? `${o.swings} swings vs ${o.comparedWith}` : "first snapshot, nothing to compare",
    ...(o.stoppedAtCapUsd ? [`STOPPED at $${o.stoppedAtCapUsd} cap`] : []),
  ].join(", ");
}
