/**
 * Shapes for the monthly health report (task 5.3, PROJECT-PLAN §5A). The
 * loader (load.ts) and the sample generator (sample.ts) both produce an
 * ItemMonthInput; aggregate.ts turns it into an ItemReport with no database
 * or AI calls, so the numbers are testable on their own.
 */
import type { ProviderId } from "@/lib/answers";
import type { AnswerFindings, Labels, Metric, SnapshotNoise, Swing } from "@/lib/snapshots";

export interface ReportMonth {
  /** "2026-12" */
  key: string;
  /** "December 2026" */
  label: string;
  /** First instant of the month, UTC. */
  start: Date;
  /** First instant of the next month, UTC. */
  end: Date;
}

export interface AskedFrom {
  city: string;
  region: string;
  country: string;
}

/** One stored snapshot, reduced to what the report compares. */
export interface SnapshotInput {
  runId: string;
  kind: "weekly" | "event";
  startedAt: Date;
  askedFrom: AskedFrom | null;
  answers: AnswerFindings[];
  labels: Labels;
  noise: SnapshotNoise;
}

export type MarkKind = "new_model" | "model_switch" | "event";

/** Something to mark on the month's timeline. */
export interface TimelineMark {
  at: Date;
  kind: MarkKind;
  /** Short title, e.g. "Gemini default: gemini-3.5-flash". */
  label: string;
  provider?: ProviderId;
  /** The snapshot it triggered, when there was one. */
  runId?: string;
  sourceUrl?: string;
}

export interface ItemMonthInput {
  watchItem: { id: string; name: string; askedFrom: AskedFrom };
  month: ReportMonth;
  /** The item's last snapshot before the month, the "start" to compare from; null for an item's first month. */
  baseline: SnapshotInput | null;
  /** Weekly and event snapshots in the month, oldest first. */
  snapshots: SnapshotInput[];
  /** Complete or partial weekly snapshots the item has, from its first through the month's end. */
  weeklyCount: number;
  marks: TimelineMark[];
}

/** A finding's share of locked answers at the start and end of the month. */
export interface FindingRow {
  key: string;
  label: string;
  start: number;
  end: number;
  countStart: number;
  countEnd: number;
  /** Beyond the noise band (a swing from compareSnapshots). */
  real: boolean;
  kind?: Swing["kind"];
}

export interface SeriesPoint {
  runId: string;
  at: Date;
  kind: SnapshotInput["kind"];
  /** Share of locked answers, by finding key. */
  shares: Record<string, number>;
}

export interface BreadthRow {
  key: string;
  label: string;
  /** Fresh answers (across the month) that had it. */
  count: number;
  share: number;
}

export interface ItemReport {
  watchItem: ItemMonthInput["watchItem"];
  month: ReportMonth;
  /** "Asked as a user in Austin, Texas" — every location the month's snapshots used. */
  locationLine: string;
  snapshots: { runId: string; at: Date; kind: SnapshotInput["kind"]; lockedAnswers: number; freshAnswers: number }[];
  startRunId: string;
  startAt: Date;
  endRunId: string;
  endAt: Date;
  /** True when the start is the last snapshot of the previous month. */
  startIsBaseline: boolean;
  /** Locked questions compared (asked by both start and end). */
  questionsCompared: number;
  /** Changes beyond the noise band, all AIs, entities/themes/lean/tone. */
  depthChanges: Swing[];
  /** Changes beyond the noise band in cited sources, all AIs and per AI. */
  citationChanges: Swing[];
  /** Top findings at the end of the month, per kind, with their start share. */
  top: Record<Metric, FindingRow[]>;
  /** Top cited sources per AI at the end of the month. */
  topDomainsByAi: Partial<Record<ProviderId, FindingRow[]>>;
  /** Share of each top theme at every snapshot, for the depth chart. */
  themeSeries: { keys: string[]; labels: Labels; points: SeriesPoint[] };
  breadth: {
    freshQuestions: number;
    freshAnswers: number;
    /** Share of distinct things the fresh answers named that the locked answers never did, per kind. */
    newShare: Record<"entity" | "theme" | "domain", number | null>;
    rows: Record<"entity" | "theme" | "domain", BreadthRow[]>;
  };
  marks: TimelineMark[];
  /** The all-AI noise band at the end snapshot, per kind, in share points (0.09 = 9 points). */
  band: Partial<Record<Metric, number>>;
}

export interface SkippedItem {
  watchItemId: string;
  name: string;
  reason: string;
}

export interface MonthlyReport {
  month: ReportMonth;
  generatedAt: Date;
  sample: boolean;
  items: ItemReport[];
  skipped: SkippedItem[];
  summary: { text: string; source: "model" | "fallback"; costUsd: number; note?: string };
  /** TODO(5.2): the month's alerts, once lib/alerts lands. */
  alerts: null;
}
