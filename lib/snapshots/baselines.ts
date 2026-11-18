/**
 * Which earlier snapshots a new one is compared with, and which of its
 * changes hold against all of them (Nov 18, 2026).
 *
 * One baseline let a single odd snapshot fake a change or hide one. Now a new
 * snapshot is compared with up to three earlier ones of the same watch item:
 * the most recent snapshot of any kind (the primary) and the last two weekly
 * snapshots. A change counts only when it is beyond the noise band, in the
 * same direction, against every baseline. Its numbers stay those against the
 * primary, which is the "before" side the alert's shares and quotes come from.
 *
 * Baselines must have started before `before`: for a weekly snapshot that's
 * when it started; for an event snapshot it's when the event happened, so a
 * snapshot that may already show the event's effect is never the baseline.
 * Model-switch runs are never baselines: each mixes an AI's old and new model.
 */
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import type { Comparison, Swing } from "./compare";

/** Weekly snapshots used as baselines, besides the most recent snapshot of any kind. */
export const WEEKLY_BASELINES = 2;

export interface BaselineComparison extends Comparison {
  /** The primary baseline: the most recent earlier snapshot. Swing numbers are against it. */
  againstRunId: string;
  /** Every baseline the swings held against, the primary first. */
  confirmedAgainst: string[];
  /** Swings beyond the band against the primary that another baseline didn't confirm. */
  unconfirmed: number;
}

type Compare = (db: PrismaClient, beforeRunId: string, afterRunId: string) => Promise<Comparison>;

const usable = { status: { in: ["complete" as const, "partial" as const] }, kind: { not: "model_switch" as const } };

/** Baseline run IDs, the primary (most recent) first, without repeats. Empty when there is none. */
export async function findBaselines(db: PrismaClient, watchItemId: string, opts: { runId: string; before: Date }): Promise<string[]> {
  const where = { watchItemId, id: { not: opts.runId }, startedAt: { lt: opts.before }, stats: { not: Prisma.AnyNull }, ...usable };
  const [primary, weeklies] = await Promise.all([
    db.run.findFirst({ where, orderBy: { startedAt: "desc" }, select: { id: true } }),
    db.run.findMany({ where: { ...where, kind: "weekly" }, orderBy: { startedAt: "desc" }, take: WEEKLY_BASELINES, select: { id: true } }),
  ]);
  if (!primary) return [];
  return [...new Set([primary.id, ...weeklies.map((r) => r.id)])];
}

const swingKey = (s: Swing) => `${s.scope}|${s.metric}|${s.key}`;

/**
 * Keeps the primary's swings that every other comparison also found, in the
 * same direction. A baseline that shares no locked questions with the new
 * snapshot can't confirm or refute anything and is left out.
 */
export function confirmSwings(primary: Comparison, others: { runId: string; comparison: Comparison }[]): { swings: Swing[]; confirmedAgainst: string[]; unconfirmed: number } {
  const checks = others.filter((o) => o.comparison.questions > 0);
  const found = checks.map((o) => new Map(o.comparison.swings.map((s) => [swingKey(s), Math.sign(s.change)])));
  const swings = primary.swings.filter((s) => found.every((m) => m.get(swingKey(s)) === Math.sign(s.change)));
  return { swings, confirmedAgainst: checks.map((o) => o.runId), unconfirmed: primary.swings.length - swings.length };
}

/** Compares `runId` with its baselines. Null when the item has no earlier snapshot to compare with. */
export async function compareWithBaselines(
  db: PrismaClient,
  watchItemId: string,
  runId: string,
  opts: { before: Date; compare: Compare }
): Promise<BaselineComparison | null> {
  const [primaryId, ...otherIds] = await findBaselines(db, watchItemId, { runId, before: opts.before });
  if (!primaryId) return null;
  const primary = await opts.compare(db, primaryId, runId);
  const others = [];
  for (const id of otherIds) others.push({ runId: id, comparison: await opts.compare(db, id, runId) });
  const { swings, confirmedAgainst, unconfirmed } = confirmSwings(primary, others);
  return { ...primary, swings, againstRunId: primaryId, confirmedAgainst: [primaryId, ...confirmedAgainst], unconfirmed };
}
