import { prisma } from "@/lib/db";
import { reportError } from "@above-public-affairs/error-reporter";
import type { RunPipelineResult } from "@/lib/pipeline/run";

/**
 * Daily AI spend cap. Spend is each analysis's cost (answers plus
 * extraction, from token usage and the price table), recorded after the
 * analysis and summed per UTC day in Postgres. Once the day's estimate
 * reaches the cap, new analyses are refused until midnight UTC.
 *
 * Set `DAILY_SPEND_CAP_USD` on the service to change the cap; `0` disables it.
 * Analyses already running when the cap is crossed finish, so a day can end a
 * little over the cap (the per-IP rate limit bounds how much).
 */
const DEFAULT_DAILY_CAP_USD = 50;

export function dailySpendCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_CAP_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP_USD;
}

/**
 * A provider call cut off by the deadline is still billed for what it
 * generated, but reports no cost. Counted at roughly a long Claude answer
 * with searches, so the cap errs early rather than late.
 */
export const ABORTED_CALL_ESTIMATE_USD = 0.15;

/** Counted for a run that failed partway, whose real cost is unknown. */
export const UNMETERED_RUN_ESTIMATE_USD = 1;

/**
 * Spend to count for one pipeline run: each answer's cost and each
 * extraction's cost (computed from usage and lib/answers/prices.ts), plus an
 * estimate for calls the deadline cut off.
 */
export function runSpendUsd(run: Pick<RunPipelineResult, "costUsd" | "answers">): number {
  const aborted = run.answers.filter((a) => !a.ok && a.errorKind === "timeout").length;
  return run.costUsd + aborted * ABORTED_CALL_ESTIMATE_USD;
}

function utcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** True when today's estimated spend has reached the cap. Throws if the DB is down. */
export async function isOverDailySpendCap(): Promise<boolean> {
  const cap = dailySpendCapUsd();
  if (cap === 0) return false;
  const row = await prisma.dailySpend.findUnique({ where: { day: utcDay() } });
  return (row?.costUsd ?? 0) >= cap;
}

/**
 * Add one analysis's estimated cost to today's total. Reports once per day,
 * the first time the total crosses the cap. Never throws: a failed write
 * shouldn't fail an analysis that has already been paid for.
 */
export async function recordSpend(costUsd: number): Promise<void> {
  try {
    const day = utcDay();
    const row = await prisma.dailySpend.upsert({
      where: { day },
      create: { day, costUsd, analyses: 1 },
      update: { costUsd: { increment: costUsd }, analyses: { increment: 1 } },
    });
    const cap = dailySpendCapUsd();
    if (cap > 0 && row.costUsd >= cap && !row.capAlerted) {
      // Only the request that flips the flag reports.
      const flipped = await prisma.dailySpend.updateMany({
        where: { day, capAlerted: false },
        data: { capAlerted: true },
      });
      if (flipped.count > 0) {
        reportError({
          project: "ai-topic-explorer",
          category: "spend_cap",
          message: `Daily spend cap reached: ~$${row.costUsd.toFixed(2)} of $${cap} across ${row.analyses} analyses. New analyses are paused until 00:00 UTC.`,
        });
      }
    }
  } catch (e) {
    console.error("[Spend] Failed to record spend:", e);
    reportError({
      project: "ai-topic-explorer",
      category: "database_error",
      message: "Failed to record analysis spend",
      rawError: e,
    });
  }
}
