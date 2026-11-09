/**
 * Agreement across repeats (PROJECT-PLAN §4C). Each locked question is asked
 * N times per snapshot; for each question × AI, a finding **holds** when it
 * shows up in more than half of that pair's usable repeats and in at least two
 * of them. With 2 repeats that means both; with 3, any 2. Everything else the
 * repeats said is **noisy**. A pair with fewer than 2 usable repeats (a call
 * or extraction failed) can't be judged and is left out of the counts.
 */
import type { ProviderId } from "@/lib/answers";
import { METRICS, type AnswerFindings, type Metric } from "./findings";

export const HOLD_RULE =
  "A finding holds when it appears in more than half of a question × AI's repeats and in at least 2 of them (2 repeats: both; 3 repeats: any 2).";

/** How many of `repeats` a finding must appear in to hold. */
export function holdThreshold(repeats: number): number {
  return Math.max(2, Math.floor(repeats / 2) + 1);
}

export interface PairAgreement {
  questionId: string;
  questionLabel: string;
  provider: ProviderId;
  /** Usable repeats (answered and extracted). */
  repeats: number;
  held: Record<Metric, string[]>;
  noisy: Record<Metric, string[]>;
}

export interface AgreementSummary {
  rule: string;
  /** Pairs judged (≥ 2 usable repeats) and pairs skipped. */
  pairs: number;
  skipped: number;
  totals: Record<Metric, { held: number; noisy: number }>;
  /** Share of findings that held, per kind. */
  heldRate: Record<Metric, number | null>;
  byPair: PairAgreement[];
}

const emptyLists = () => Object.fromEntries(METRICS.map((m) => [m, [] as string[]])) as Record<Metric, string[]>;

/** Judge one question × AI pair from its repeats' findings. */
export function pairAgreement(repeats: AnswerFindings[]): Pick<PairAgreement, "held" | "noisy" | "repeats"> {
  const need = holdThreshold(repeats.length);
  const held = emptyLists();
  const noisy = emptyLists();
  for (const m of METRICS) {
    const counts = new Map<string, number>();
    for (const r of repeats) for (const key of new Set(r.findings[m])) counts.set(key, (counts.get(key) ?? 0) + 1);
    for (const [key, n] of [...counts].sort(([a], [b]) => a.localeCompare(b))) (n >= need ? held : noisy)[m].push(key);
  }
  return { repeats: repeats.length, held, noisy };
}

/** Agreement over a snapshot's locked questions. Fresh questions are asked once and aren't judged. */
export function agreement(answers: AnswerFindings[]): AgreementSummary {
  const groups = new Map<string, AnswerFindings[]>();
  for (const a of answers) {
    if (!a.locked) continue;
    const key = `${a.questionId}|${a.provider}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const totals = Object.fromEntries(METRICS.map((m) => [m, { held: 0, noisy: 0 }])) as AgreementSummary["totals"];
  const byPair: PairAgreement[] = [];
  let skipped = 0;
  for (const rows of groups.values()) {
    if (rows.length < 2) {
      skipped++;
      continue;
    }
    const pair = { questionId: rows[0].questionId, questionLabel: rows[0].questionLabel, provider: rows[0].provider, ...pairAgreement(rows) };
    for (const m of METRICS) {
      totals[m].held += pair.held[m].length;
      totals[m].noisy += pair.noisy[m].length;
    }
    byPair.push(pair);
  }
  byPair.sort((a, b) => a.questionLabel.localeCompare(b.questionLabel, undefined, { numeric: true }) || a.provider.localeCompare(b.provider));
  const heldRate = Object.fromEntries(
    METRICS.map((m) => {
      const t = totals[m].held + totals[m].noisy;
      return [m, t ? totals[m].held / t : null];
    })
  ) as AgreementSummary["heldRate"];
  return { rule: HOLD_RULE, pairs: byPair.length, skipped, totals, heldRate, byPair };
}
