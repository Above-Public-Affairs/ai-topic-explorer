/**
 * Runs this process created and hasn't finished, so a worker stopped by
 * SIGTERM can release them (lib/worker/shutdown.ts). Type imports only, so
 * lib/snapshots and the workers use it without an import cycle.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";

const activeRuns = new Set<string>();

export function trackRun(runId: string): void {
  activeRuns.add(runId);
}

export function untrackRun(runId: string): void {
  activeRuns.delete(runId);
}

export function trackedRuns(): string[] {
  return [...activeRuns];
}

/** Alerts this process has claimed for sending and not finished (task 6.6, code review M4). */
const sendingAlerts = new Set<string>();

export function trackSending(alertId: string): void {
  sendingAlerts.add(alertId);
}

export function untrackSending(alertId: string): void {
  sendingAlerts.delete(alertId);
}

export function trackedSending(): string[] {
  return [...sendingAlerts];
}

/** What a run has cost so far: its answers and their extractions. Fresh-question and theme costs aren't stored per row. */
export async function spentSoFar(db: PrismaClient, runId: string): Promise<number> {
  const [answers, extractions] = await Promise.all([
    db.answer.aggregate({ where: { runId }, _sum: { costUsd: true } }),
    db.extraction.aggregate({ where: { answer: { runId } }, _sum: { costUsd: true } }),
  ]);
  return Math.round(((answers._sum.costUsd ?? 0) + (extractions._sum.costUsd ?? 0)) * 1e8) / 1e8;
}
