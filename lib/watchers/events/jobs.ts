/**
 * WatcherJob claims: a Railway cron runs on every deploy as well as on its
 * schedule, so each unit of work (the day's scan, the week's known-dates
 * refresh, one event snapshot) is claimed by key first. A second process finds
 * the key and skips; a failed or orphaned job is retried, up to MAX_ATTEMPTS.
 */
import { Prisma, type PrismaClient } from "@/app/generated/prisma/client";
import { roundUsd } from "@/lib/answers/shared";
import { claimDecision } from "./rules";

export type Claim = { claimed: true; attempt: number } | { claimed: false; reason: string };

export async function claimJob(db: PrismaClient, key: string, kind: string, now = new Date()): Promise<Claim> {
  try {
    await db.watcherJob.create({ data: { key, kind, status: "running", startedAt: now } });
    return { claimed: true, attempt: 1 };
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
  }
  const existing = await db.watcherJob.findUnique({ where: { key } });
  const decision = claimDecision(existing, now);
  if ("skip" in decision) return { claimed: false, reason: decision.skip };
  // Optimistic: only one process moves attempts from n to n+1.
  const taken = await db.watcherJob.updateMany({
    where: { key, attempts: existing!.attempts, status: existing!.status },
    data: { status: "running", attempts: { increment: 1 }, startedAt: now, finishedAt: null, note: null },
  });
  if (taken.count === 0) return { claimed: false, reason: "taken by another process" };
  return { claimed: true, attempt: existing!.attempts + 1 };
}

export async function finishJob(
  db: PrismaClient,
  key: string,
  status: "complete" | "failed" | "skipped",
  extra: { costUsd?: number; stats?: unknown; note?: string } = {}
): Promise<void> {
  await db.watcherJob.update({
    where: { key },
    data: {
      status,
      finishedAt: new Date(),
      costUsd: extra.costUsd == null ? null : roundUsd(extra.costUsd),
      stats: extra.stats === undefined ? Prisma.DbNull : (JSON.parse(JSON.stringify(extra.stats)) as Prisma.InputJsonValue),
      note: extra.note?.slice(0, 2000) ?? null,
    },
  });
}
