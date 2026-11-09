/**
 * Which changes between two snapshots of a watch item are beyond the noise
 * band (PROJECT-PLAN §4C). Compares the locked questions both snapshots asked
 * (the depth measure), across all AIs and per AI. The alerts (5.2) and the
 * monthly report (5.3) build on this; it decides nothing about wording.
 */
import { METRICS, type AnswerFindings, type Labels, type Metric } from "./findings";
import { BAND_Z, FALLBACK_SIGMA, inScope, keySigma, passesOf, shares, threshold, type Scope, type SnapshotNoise } from "./noise";

/** A swing needs the finding in at least this many answers on one side, so stray mentions never count. */
export const MIN_COUNT = 4;
/** …and its answer count must move by at least this many. */
export const MIN_COUNT_CHANGE = 3;

export interface CompareOptions {
  z?: number;
  minCount?: number;
  minCountChange?: number;
}

export interface SnapshotForCompare {
  answers: AnswerFindings[];
  labels?: Labels;
  noise: SnapshotNoise;
}

export interface Swing {
  scope: Scope;
  metric: Metric;
  key: string;
  label: string;
  before: number;
  after: number;
  /** after − before, as a share (0.25 = 25 points). */
  change: number;
  threshold: number;
  countBefore: number;
  countAfter: number;
  /** "new" when absent before, "gone" when absent after. */
  kind: "rose" | "fell" | "new" | "gone";
}

export interface Comparison {
  /** Locked questions both snapshots asked; only these are compared. */
  questions: number;
  swings: Swing[];
}

export function compareSnapshots(before: SnapshotForCompare, after: SnapshotForCompare, options: CompareOptions = {}): Comparison {
  const z = options.z ?? BAND_Z;
  const minCount = options.minCount ?? MIN_COUNT;
  const minCountChange = options.minCountChange ?? MIN_COUNT_CHANGE;
  const asked = (s: SnapshotForCompare) => new Set(s.answers.filter((a) => a.locked).map((a) => a.questionId));
  const beforeQs = asked(before);
  const common = new Set([...asked(after)].filter((q) => beforeQs.has(q)));
  const keep = (s: SnapshotForCompare) => s.answers.filter((a) => a.locked && common.has(a.questionId));
  const a = keep(before);
  const b = keep(after);
  const labels = { ...before.labels, ...after.labels };

  const scopes = new Set<Scope>(["all", ...a.map((x) => x.provider), ...b.map((x) => x.provider)]);
  const swings: Swing[] = [];
  for (const scope of scopes) {
    const sa = a.filter(inScope(scope));
    const sb = b.filter(inScope(scope));
    if (!sa.length || !sb.length) continue;
    const passesA = passesOf(sa).length;
    const passesB = passesOf(sb).length;
    for (const metric of METRICS) {
      const na = before.noise[scope]?.[metric]?.sigma ?? null;
      const nb = after.noise[scope]?.[metric]?.sigma ?? null;
      const pa = shares(sa, metric).byKey;
      const pb = shares(sb, metric).byKey;
      for (const key of new Set([...pa.keys(), ...pb.keys()])) {
        const x = pa.get(key) ?? { count: 0, share: 0 };
        const y = pb.get(key) ?? { count: 0, share: 0 };
        const change = y.share - x.share;
        if (Math.max(x.count, y.count) < minCount || Math.abs(y.count - x.count) < minCountChange) continue;
        // A finding that swings more than its kind between passes (a volatile source) is judged by its own spread.
        const sigmaA = Math.max(na ?? nb ?? FALLBACK_SIGMA, keySigma(sa, metric, key) ?? 0);
        const sigmaB = Math.max(nb ?? na ?? FALLBACK_SIGMA, keySigma(sb, metric, key) ?? 0);
        const limit = threshold({ sigma: sigmaA, passes: passesA }, { sigma: sigmaB, passes: passesB }, z);
        // Shares are fractions of whole answers; the epsilon keeps a change equal to the band from counting.
        if (Math.abs(change) <= limit + 1e-9) continue;
        swings.push({
          scope,
          metric,
          key,
          label: labels[key] ?? key,
          before: x.share,
          after: y.share,
          change,
          threshold: limit,
          countBefore: x.count,
          countAfter: y.count,
          kind: x.count === 0 ? "new" : y.count === 0 ? "gone" : change > 0 ? "rose" : "fell",
        });
      }
    }
  }
  // Biggest relative to its band first.
  swings.sort((p, q) => Math.abs(q.change) / q.threshold - Math.abs(p.change) / p.threshold);
  return { questions: common.size, swings };
}
