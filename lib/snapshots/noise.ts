/**
 * A snapshot's noise band (PROJECT-PLAN §4C).
 *
 * A finding's **share** is the fraction of a snapshot's locked-question
 * answers that contain it (an entity named, a domain cited, a theme raised,
 * a tone, a lean of arguments), across all AIs and per AI.
 *
 * Each repeat round (every locked question asked once by every AI) is a
 * complete pass. With nothing changing in the world, two passes still give
 * different shares; that difference is the noise. We measure how far each
 * common finding's share moves from pass to pass, pool it over the findings
 * of that kind, and get one per-pass spread (sigma) per kind and per AI. A
 * snapshot's share averages its N passes, so comparing two snapshots carries
 * the noise of both averages; a change counts as a swing only when it is more
 * than three times that, and never less than 5 points. When one finding moves
 * more between passes than its kind does (a volatile source), its own spread
 * is used instead (compare.ts).
 */
import type { ProviderId } from "@/lib/answers";
import { METRICS, type AnswerFindings, type Metric } from "./findings";

export type Scope = "all" | ProviderId;

/** Changes smaller than this never count, whatever the measured noise. */
export const BAND_FLOOR = 0.05;
/**
 * How many noise widths a change must exceed. 3, not the textbook 2: a
 * comparison tests hundreds of findings at once, and at 2 two snapshots taken
 * minutes apart still showed dozens of "swings" (task 4.3 proof).
 */
export const BAND_Z = 3;
/** Findings at least this common (pooled share) set sigma; rarer ones barely move and would understate it. */
export const COMMON_SHARE = 0.1;
/** Per-pass sigma assumed when a snapshot has no repeats to measure it from. */
export const FALLBACK_SIGMA = 0.1;

export interface MetricNoise {
  /** Repeat passes measured. */
  passes: number;
  /** Findings that set sigma. */
  keys: number;
  /** Pass-to-pass spread of a share (standard deviation); null with fewer than 2 passes. */
  sigma: number | null;
  /** Threshold against a snapshot with the same noise and passes: a change must exceed it to be a swing. */
  band: number;
}

export type SnapshotNoise = Partial<Record<Scope, Record<Metric, MetricNoise>>>;

export interface Share {
  count: number;
  share: number;
}

export const inScope = (scope: Scope) => (a: AnswerFindings) => a.locked && (scope === "all" || a.provider === scope);

/** Pooled shares for one kind of finding over the given answers. */
export function shares(answers: AnswerFindings[], metric: Metric): { total: number; byKey: Map<string, Share> } {
  const counts = new Map<string, number>();
  for (const a of answers) for (const key of new Set(a.findings[metric])) counts.set(key, (counts.get(key) ?? 0) + 1);
  const total = answers.length;
  return { total, byKey: new Map([...counts].map(([k, count]) => [k, { count, share: total ? count / total : 0 }])) };
}

/** Threshold for a change between two snapshots, from each one's sigma and passes. */
export function threshold(a: { sigma: number | null; passes: number }, b: { sigma: number | null; passes: number }, z = BAND_Z): number {
  const sa = a.sigma ?? b.sigma ?? FALLBACK_SIGMA;
  const sb = b.sigma ?? a.sigma ?? FALLBACK_SIGMA;
  const na = Math.max(1, a.passes);
  const nb = Math.max(1, b.passes);
  return Math.max(BAND_FLOOR, z * Math.sqrt((sa * sa) / na + (sb * sb) / nb));
}

/** Answers grouped into repeat passes. */
export function passesOf(answers: AnswerFindings[]): AnswerFindings[][] {
  const byRepeat = new Map<number, AnswerFindings[]>();
  for (const a of answers) byRepeat.set(a.repeat, [...(byRepeat.get(a.repeat) ?? []), a]);
  return [...byRepeat.values()].filter((p) => p.length > 0);
}

/** One finding's own pass-to-pass spread (sample SD of its share); null with fewer than 2 passes. */
export function keySigma(answers: AnswerFindings[], metric: Metric, key: string): number | null {
  const passes = passesOf(answers);
  if (passes.length < 2) return null;
  const xs = passes.map((p) => p.filter((a) => a.findings[metric].includes(key)).length / p.length);
  const mean = xs.reduce((x, y) => x + y, 0) / xs.length;
  return Math.sqrt(xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (xs.length - 1));
}

/** Pass-to-pass noise for one kind of finding within one scope. */
export function metricNoise(answers: AnswerFindings[], metric: Metric): MetricNoise {
  const passes = passesOf(answers);
  if (passes.length < 2) {
    return { passes: passes.length, keys: 0, sigma: null, band: threshold({ sigma: null, passes: passes.length }, { sigma: null, passes: passes.length }) };
  }
  const pooled = shares(answers, metric).byKey;
  const passShares = passes.map((p) => shares(p, metric));
  const variance = (key: string) => {
    const xs = passShares.map((s) => s.byKey.get(key)?.share ?? 0);
    const mean = xs.reduce((x, y) => x + y, 0) / xs.length;
    return xs.reduce((sum, x) => sum + (x - mean) ** 2, 0) / (xs.length - 1);
  };
  let keys = [...pooled].filter(([, s]) => s.share >= COMMON_SHARE).map(([k]) => k);
  if (keys.length === 0) keys = [...pooled.keys()];
  const sigma = keys.length ? Math.sqrt(keys.reduce((sum, k) => sum + variance(k), 0) / keys.length) : null;
  const self = { sigma, passes: passes.length };
  return { passes: passes.length, keys: keys.length, sigma, band: threshold(self, self) };
}

/** The noise band for every kind of finding, across all AIs and per AI. */
export function noiseBand(answers: AnswerFindings[]): SnapshotNoise {
  const providers = [...new Set(answers.filter((a) => a.locked).map((a) => a.provider))].sort();
  const out: SnapshotNoise = {};
  for (const scope of ["all", ...providers] as Scope[]) {
    const rows = answers.filter(inScope(scope));
    out[scope] = Object.fromEntries(METRICS.map((m) => [m, metricNoise(rows, m)])) as Record<Metric, MetricNoise>;
  }
  return out;
}

