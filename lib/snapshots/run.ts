/**
 * One snapshot of a watch item (PROJECT-PLAN §4B–4C): create the Run, get
 * its questions (questionsForSnapshot), ask each locked question N times as
 * separate, identical calls and each fresh question once, then work out which
 * findings held across repeats and the snapshot's noise band, and store both
 * on Run.stats. The weekly worker (4.4) calls runSnapshot().
 */
import type { PrismaClient, RunKind } from "@/app/generated/prisma/client";
import type { ProviderId, UserLocation } from "@/lib/answers";
import { questionsForSnapshot, type Generator } from "@/lib/questions";
import { runPipeline, type RunPipelineResult } from "@/lib/pipeline/run";
import { agreement, type AgreementSummary } from "./agreement";
import { loadFindings, type Labels } from "./findings";
import { noiseBand, type SnapshotNoise } from "./noise";
import { compareSnapshots, type Comparison } from "./compare";
import { linkThemes } from "@/lib/themes/link";
import { trackRun, untrackRun } from "@/lib/worker/active-runs";

/** Repeats per locked question; chosen from task 4.3's proof (PROJECT-PLAN §4C). */
export const DEFAULT_REPEATS = 3;
export const STATS_VERSION = 1;

export interface SnapshotStats {
  version: typeof STATS_VERSION;
  repeats: number;
  answers: { locked: number; fresh: number };
  agreement: AgreementSummary;
  noise: SnapshotNoise;
  /** Display names for canonical-entity keys ("c:<id>") and canonical-theme keys ("t:<slug>"). */
  labels: Labels;
  /** Set when the snapshot was stopped at its spending cap. */
  stoppedAtCapUsd?: number;
  /** Changes beyond the noise band since the item's previous snapshot; set by the weekly worker (4.4). */
  comparison?: Comparison & { againstRunId: string };
}

export interface RunSnapshotOptions {
  kind?: RunKind;
  /** Repeats per locked question (2 or 3). */
  repeats?: number;
  providers?: ProviderId[];
  /** Stop asking once answer costs pass this; calls not yet made are skipped. */
  maxCostUsd?: number;
  /** Provider calls in flight at once. */
  askConcurrency?: number;
  note?: string;
  signal?: AbortSignal;
  generate?: Generator;
  onAnswer?: Parameters<typeof runPipeline>[1]["onAnswer"];
}

export interface RunSnapshotResult {
  runId: string;
  pipeline: RunPipelineResult;
  /** Answer, extraction, fresh-set and theme-mapping costs. */
  costUsd: number;
  stats: SnapshotStats;
}

export async function runSnapshot(db: PrismaClient, watchItemId: string, options: RunSnapshotOptions = {}): Promise<RunSnapshotResult> {
  const repeats = options.repeats ?? DEFAULT_REPEATS;
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error(`repeats must be 1–5, got ${repeats}`);
  const item = await db.watchItem.findUniqueOrThrow({
    where: { id: watchItemId },
    include: { subTopics: { where: { retiredAt: null } } },
  });
  const location: UserLocation = {
    city: item.askCity,
    region: item.askRegion,
    country: item.askCountry,
    ...(item.askTimezone ? { timezone: item.askTimezone } : {}),
  };
  const run = await db.run.create({
    data: {
      kind: options.kind ?? "weekly",
      watchItemId,
      topic: item.topic,
      askCity: location.city,
      askRegion: location.region,
      askCountry: location.country,
      askTimezone: location.timezone ?? null,
      note: options.note ?? null,
    },
    select: { id: true },
  });

  // Tracked so a worker stopped by SIGTERM can release it (lib/worker/shutdown.ts).
  trackRun(run.id);
  try {
    let set;
    try {
      set = await questionsForSnapshot(db, { watchItemId, runId: run.id }, { generate: options.generate, signal: options.signal });
    } catch (err) {
      await db.run.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), note: `${options.note ?? ""} questions: ${String(err)}`.trim() } });
      throw err;
    }

    // Repeat-major order, so a run stopped at its cap still has whole passes first.
    const questions = [
      ...Array.from({ length: repeats }, (_, i) => set.locked.map((q) => ({ text: q.text, questionId: q.id, repeat: i + 1 }))).flat(),
      ...set.fresh.map((q) => ({ text: q.text, questionId: q.id, repeat: 1 })),
    ];

    const stop = new AbortController();
    const signal = options.signal ? AbortSignal.any([options.signal, stop.signal]) : stop.signal;
    let spent = 0;
    let stoppedAtCap = false;
    const pipeline = await runPipeline(db, {
      kind: options.kind ?? "weekly",
      topic: item.topic,
      questions,
      location,
      providers: options.providers,
      watchItemId,
      runId: run.id,
      subTopics: item.subTopics.map((s) => ({ id: s.id, name: s.name })),
      askConcurrency: options.askConcurrency,
      signal,
      // Extractions of answers already paid for still run after a stop.
      extractionSignal: options.signal,
      onAnswer: (e) => {
        if (e.ok) spent += e.result.cost.usd;
        if (options.maxCostUsd != null && spent > options.maxCostUsd && !stop.signal.aborted) {
          stoppedAtCap = true;
          stop.abort(new Error(`spending cap $${options.maxCostUsd} reached`));
        }
        options.onAnswer?.(e);
      },
    });

    // Themes the alias table didn't know: one batched mapper call (task 4.8).
    // A failure leaves them unlinked; findings then key them by their label.
    let themeCostUsd = 0;
    try {
      themeCostUsd = (await linkThemes(db, { runId: run.id, signal: options.signal })).costUsd;
    } catch (err) {
      console.warn(`[Snapshot] Theme linking failed for ${run.id}; unlinked themes count by label. ${err instanceof Error ? err.message : err}`);
    }

    const stats = await snapshotStats(db, run.id, repeats);
    if (stoppedAtCap) stats.stoppedAtCapUsd = options.maxCostUsd;
    const costUsd = pipeline.costUsd + set.costUsd + themeCostUsd;
    await db.run.update({
      where: { id: run.id },
      data: { stats: JSON.parse(JSON.stringify(stats)), costUsd: Math.round(costUsd * 1e8) / 1e8 },
    });
    return { runId: run.id, pipeline, costUsd, stats };
  } finally {
    untrackRun(run.id);
  }
}

/** Agreement and noise band for a run already answered. Safe to recompute. */
export async function snapshotStats(db: PrismaClient, runId: string, repeats: number): Promise<SnapshotStats> {
  const { answers, labels } = await loadFindings(db, runId);
  const summary = agreement(answers);
  const used = new Set(
    summary.byPair.flatMap((p) => Object.values(p.held).concat(Object.values(p.noisy)).flat()).filter((k) => k.startsWith("c:") || k.startsWith("t:"))
  );
  return {
    version: STATS_VERSION,
    repeats,
    answers: { locked: answers.filter((a) => a.locked).length, fresh: answers.filter((a) => !a.locked).length },
    agreement: summary,
    noise: noiseBand(answers),
    labels: Object.fromEntries(Object.entries(labels).filter(([k]) => used.has(k) || !/^[ct]:/.test(k))),
  };
}

/** Compare two stored snapshots: which changes are beyond the noise band. */
export async function compareRuns(db: PrismaClient, beforeRunId: string, afterRunId: string): Promise<Comparison> {
  const load = async (runId: string) => {
    const run = await db.run.findUniqueOrThrow({ where: { id: runId }, select: { stats: true } });
    const stats = run.stats as SnapshotStats | null;
    const { answers, labels } = await loadFindings(db, runId);
    return { answers, labels, noise: stats?.noise ?? noiseBand(answers) };
  };
  const [before, after] = await Promise.all([load(beforeRunId), load(afterRunId)]);
  return compareSnapshots(before, after);
}
