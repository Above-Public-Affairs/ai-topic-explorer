import { prisma } from "@/lib/db";
import { reportError } from "@above-public-affairs/error-reporter";
import type { AIResponse, TokenUsage } from "@/lib/types";

/**
 * Daily AI spend cap. Spend is an estimate from token usage, recorded after
 * each analysis and summed per UTC day in Postgres. Once the day's estimate
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
 * USD per million tokens. Deliberately on the high side of each provider's
 * list price for the models we call, so the cap trips early rather than late.
 * Keyed by provider rather than model so a model swap doesn't silently fall
 * through to zero.
 */
const RATES: Record<string, { input: number; output: number }> = {
  claude: { input: 3, output: 15 },
  openai: { input: 2.5, output: 15 },
  gemini: { input: 0.5, output: 3 },
  grok: { input: 3, output: 15 },
  perplexity: { input: 1, output: 1 },
  expansion: { input: 1, output: 5 },
};
const FALLBACK_RATE = { input: 3, output: 15 };
/** Web search/grounding fees per provider query (every provider searches). */
const SEARCH_FEE_PER_QUERY_USD = 0.035;

function tokenCost(rateKey: string, u: TokenUsage): number {
  const rate = RATES[rateKey] ?? FALLBACK_RATE;
  return (u.inputTokens * rate.input + u.outputTokens * rate.output) / 1_000_000;
}

/** Estimated USD cost of one analysis. */
export function estimateAnalysisCost(
  responses: Partial<Record<string, AIResponse | null>>,
  allUsage: TokenUsage[]
): number {
  let cost = 0;
  for (const u of allUsage) {
    if (u.purpose === "expansion") cost += tokenCost("expansion", u);
  }
  for (const [provider, response] of Object.entries(responses)) {
    for (const u of response?.usage ?? []) {
      if (u.purpose !== "analysis") continue;
      cost += tokenCost(provider, u) + SEARCH_FEE_PER_QUERY_USD;
    }
  }
  return cost;
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
