import { prisma } from "@/lib/db";
import { reportError } from "@above-public-affairs/error-reporter";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { RunPipelineResult } from "@/lib/pipeline/run";

/**
 * Daily AI spend cap for the public site. Spend is each analysis's cost
 * (answers plus extraction, from token usage and the price table, with an
 * estimate for calls that failed after they were sent), summed per UTC day in
 * Postgres. Once the day's total reaches the cap, new analyses are refused
 * until midnight UTC.
 *
 * Each analysis reserves ANALYSIS_RESERVE_USD at admission, in one statement
 * that refuses when the reservation would cross the cap, and settles to its
 * real cost when it ends (task 6.6, security review M1). So requests that
 * arrive together can't all pass a cap that only one more of them fits under,
 * and the runs in flight at once are bounded by cap ÷ reserve whatever the
 * number of IPs. A day can still end a little over the cap: by how much the
 * runs in flight cost beyond their reservations.
 *
 * Set `DAILY_SPEND_CAP_USD` on the service to change the cap; `0` disables it.
 */
const DEFAULT_DAILY_CAP_USD = 50;

/**
 * Held for each analysis while it runs. A public analysis asks four AIs once
 * (about $0.15 together, PROJECT-PLAN "Measured cost"); this is several
 * times that, so most runs settle below it.
 */
export const ANALYSIS_RESERVE_USD = 0.5;

export function dailySpendCapUsd(): number {
  const raw = process.env.DAILY_SPEND_CAP_USD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_CAP_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_CAP_USD;
}

/** Counted for a run that failed partway, whose real cost is unknown. */
export const UNMETERED_RUN_ESTIMATE_USD = 1;

/**
 * Spend to count for one pipeline run: each answer's cost and each
 * extraction's cost. The pipeline already counts an estimate for calls that
 * failed after they were sent (lib/answers/estimates.ts).
 */
export function runSpendUsd(run: Pick<RunPipelineResult, "costUsd">): number {
  return run.costUsd;
}

type SpendDb = Pick<PrismaClient, "$queryRaw" | "dailySpend">;

function utcDay(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Reserve `reserveUsd` of today's budget for one analysis. Returns the amount
 * reserved (0 when the cap is off), or null when it would cross the cap.
 * Throws if the database is down.
 */
export async function reserveSpend(reserveUsd = ANALYSIS_RESERVE_USD, db: SpendDb = prisma): Promise<number | null> {
  const cap = dailySpendCapUsd();
  if (cap === 0) return 0;
  if (reserveUsd > cap) return null;
  const day = utcDay();
  // One statement: insert today's row, or add to it only while it stays under the cap.
  const rows = await db.$queryRaw<{ costUsd: number }[]>`
    INSERT INTO "DailySpend" ("day", "costUsd", "analyses", "capAlerted", "updatedAt")
    VALUES (${day}::date, ${reserveUsd}, 0, false, now())
    ON CONFLICT ("day") DO UPDATE
      SET "costUsd" = "DailySpend"."costUsd" + EXCLUDED."costUsd", "updatedAt" = now()
      WHERE "DailySpend"."costUsd" + EXCLUDED."costUsd" <= ${cap}
    RETURNING "costUsd"
  `;
  return rows.length ? reserveUsd : null;
}

/**
 * Settle one analysis: replace its reservation with what it really cost.
 * `analysis: false` only gives a reservation back (the request stopped before
 * anything was asked). Reports once per day, the first time the total
 * crosses the cap. Never throws: a failed write shouldn't fail an analysis
 * that has already been paid for.
 */
export async function settleSpend(
  { costUsd, reservedUsd, analysis = true }: { costUsd: number; reservedUsd: number; analysis?: boolean },
  db: SpendDb = prisma
): Promise<void> {
  try {
    const day = utcDay();
    const delta = costUsd - reservedUsd;
    const row = await db.dailySpend.upsert({
      where: { day },
      create: { day, costUsd: Math.max(0, delta), analyses: analysis ? 1 : 0 },
      update: { costUsd: { increment: delta }, ...(analysis ? { analyses: { increment: 1 } } : {}) },
    });
    const cap = dailySpendCapUsd();
    if (analysis && cap > 0 && row.costUsd >= cap && !row.capAlerted) {
      // Only the request that flips the flag reports.
      const flipped = await db.dailySpend.updateMany({
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
