/**
 * One watch item's month, from stored snapshots to report numbers
 * (PROJECT-PLAN §5A). Pure: no database, no AI calls.
 *
 * - Depth: the locked questions at the start of the month (the item's last
 *   snapshot before it, or the month's first) against its last snapshot,
 *   through compareSnapshots, so only changes beyond the noise band count.
 * - Breadth: what the month's fresh sets surfaced that no locked answer did.
 * - Citation shifts: the domain swings, all AIs and per AI.
 */
import type { ProviderId } from "@/lib/answers";
import { METRICS, compareSnapshots, shares, type AnswerFindings, type Labels, type Metric, type Swing } from "@/lib/snapshots";
import type { AskedFrom, BreadthRow, FindingRow, ItemMonthInput, ItemReport, SeriesPoint, SnapshotInput } from "./types";

/** How many rows of each kind the report shows. */
export const TOP_ROWS: Record<Metric, number> = { entity: 6, theme: 6, domain: 8, side: 4, tone: 5 };
export const SERIES_THEMES = 4;
export const BREADTH_ROWS = 6;
export const DOMAINS_PER_AI = 3;

const PROVIDER_ORDER: ProviderId[] = ["claude", "openai", "gemini", "grok"];

export function locationLine(places: (AskedFrom | null)[]): string {
  const seen = new Map<string, string>();
  for (const p of places) {
    if (!p) continue;
    const text = `${p.city}, ${p.region}${p.country && p.country !== "US" ? `, ${p.country}` : ""}`;
    if (!seen.has(text.toLowerCase())) seen.set(text.toLowerCase(), text);
  }
  const list = [...seen.values()];
  if (!list.length) return "Asked location not recorded";
  return `Asked as a user in ${list.length === 1 ? list[0] : `${list.slice(0, -1).join("; ")} and ${list.at(-1)}`}`;
}

function mergedLabels(snaps: SnapshotInput[]): Labels {
  return Object.assign({}, ...snaps.map((s) => s.labels));
}

const labelOf = (labels: Labels, key: string) => labels[key] ?? key;

/** Locked answers to the questions both snapshots asked (what compareSnapshots compares). */
function commonLocked(a: SnapshotInput, b: SnapshotInput): [AnswerFindings[], AnswerFindings[]] {
  const asked = (s: SnapshotInput) => new Set(s.answers.filter((x) => x.locked).map((x) => x.questionId));
  const qa = asked(a);
  const common = new Set([...asked(b)].filter((q) => qa.has(q)));
  const keep = (s: SnapshotInput) => s.answers.filter((x) => x.locked && common.has(x.questionId));
  return [keep(a), keep(b)];
}

function findingRows(
  metric: Metric,
  start: AnswerFindings[],
  end: AnswerFindings[],
  swings: Swing[],
  labels: Labels,
  limit: number
): FindingRow[] {
  const s = shares(start, metric).byKey;
  const e = shares(end, metric).byKey;
  const swingByKey = new Map(swings.filter((w) => w.metric === metric).map((w) => [w.key, w]));
  // The top at the end, plus anything that swung, plus what fell out of the top since the start.
  const byEnd = [...e].sort((x, y) => y[1].count - x[1].count).slice(0, limit).map(([k]) => k);
  const keys = new Set([...byEnd, ...swingByKey.keys()]);
  return [...keys]
    .map((key) => {
      const a = s.get(key) ?? { count: 0, share: 0 };
      const b = e.get(key) ?? { count: 0, share: 0 };
      const w = swingByKey.get(key);
      return { key, label: labelOf(labels, key), start: a.share, end: b.share, countStart: a.count, countEnd: b.count, real: !!w, ...(w ? { kind: w.kind } : {}) };
    })
    .sort((x, y) => y.end - x.end || y.start - x.start)
    .slice(0, Math.max(limit, swingByKey.size));
}

function breadthRows(
  fresh: AnswerFindings[],
  anchorKeys: Set<string>,
  metric: "entity" | "theme" | "domain",
  labels: Labels
): { rows: BreadthRow[]; newShare: number | null } {
  const counts = shares(fresh, metric).byKey;
  if (!counts.size) return { rows: [], newShare: null };
  const outside = [...counts].filter(([k]) => !anchorKeys.has(`${metric}|${k}`));
  return {
    newShare: outside.length / counts.size,
    rows: outside
      .sort((x, y) => y[1].count - x[1].count || x[0].localeCompare(y[0]))
      .slice(0, BREADTH_ROWS)
      .map(([key, v]) => ({ key, label: labelOf(labels, key), count: v.count, share: v.share })),
  };
}

export function buildItemReport(input: ItemMonthInput): ItemReport {
  const { snapshots, baseline } = input;
  if (!snapshots.length) throw new Error(`${input.watchItem.name}: no snapshots in ${input.month.label}`);
  const startSnap = baseline ?? snapshots[0];
  const endSnap = snapshots.at(-1)!;
  const all = baseline ? [baseline, ...snapshots] : snapshots;
  const labels = mergedLabels(all);

  const sameSnapshot = startSnap.runId === endSnap.runId;
  const comparison = sameSnapshot ? { questions: 0, swings: [] as Swing[] } : compareSnapshots(startSnap, endSnap);
  const [startAnswers, endAnswers] = sameSnapshot ? (() => { const x = endSnap.answers.filter((a) => a.locked); return [x, x]; })() : commonLocked(startSnap, endSnap);

  const allScope = comparison.swings.filter((w) => w.scope === "all");
  const depthChanges = allScope.filter((w) => w.metric !== "domain");
  const citationChanges = comparison.swings.filter((w) => w.metric === "domain");

  const top = Object.fromEntries(METRICS.map((m) => [m, findingRows(m, startAnswers, endAnswers, allScope, labels, TOP_ROWS[m])])) as Record<Metric, FindingRow[]>;

  const topDomainsByAi: ItemReport["topDomainsByAi"] = {};
  for (const p of PROVIDER_ORDER) {
    const a = startAnswers.filter((x) => x.provider === p);
    const b = endAnswers.filter((x) => x.provider === p);
    if (!b.length) continue;
    const swings = citationChanges.filter((w) => w.scope === p);
    topDomainsByAi[p] = findingRows("domain", a, b, swings, labels, DOMAINS_PER_AI);
  }

  // Depth chart: the themes most common across the month, at every snapshot.
  const points: SeriesPoint[] = all.map((s) => {
    const locked = s.answers.filter((a) => a.locked);
    return { runId: s.runId, at: s.startedAt, kind: s.kind, shares: Object.fromEntries([...shares(locked, "theme").byKey].map(([k, v]) => [k, v.share])) };
  });
  const mean = new Map<string, number>();
  for (const p of points) for (const [k, v] of Object.entries(p.shares)) mean.set(k, (mean.get(k) ?? 0) + v / points.length);
  const seriesKeys = [...mean].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, SERIES_THEMES).map(([k]) => k);

  // Breadth: fresh answers this month against everything the locked answers named.
  const fresh = snapshots.flatMap((s) => s.answers.filter((a) => !a.locked));
  const anchorKeys = new Set(all.flatMap((s) => s.answers.filter((a) => a.locked).flatMap((a) => (["entity", "theme", "domain"] as const).flatMap((m) => a.findings[m].map((k) => `${m}|${k}`)))));
  const b = { entity: breadthRows(fresh, anchorKeys, "entity", labels), theme: breadthRows(fresh, anchorKeys, "theme", labels), domain: breadthRows(fresh, anchorKeys, "domain", labels) };

  const band: ItemReport["band"] = {};
  for (const m of METRICS) {
    const n = endSnap.noise.all?.[m];
    if (n) band[m] = n.band;
  }

  return {
    watchItem: input.watchItem,
    month: input.month,
    // Each run keeps the location it was asked from; the item's own is the fallback for runs that didn't record one.
    locationLine: locationLine(snapshots.map((s) => s.askedFrom ?? input.watchItem.askedFrom)),
    snapshots: snapshots.map((s) => ({ runId: s.runId, at: s.startedAt, kind: s.kind, lockedAnswers: s.answers.filter((a) => a.locked).length, freshAnswers: s.answers.filter((a) => !a.locked).length })),
    startRunId: startSnap.runId,
    startAt: startSnap.startedAt,
    endRunId: endSnap.runId,
    endAt: endSnap.startedAt,
    startIsBaseline: !!baseline,
    questionsCompared: comparison.questions,
    depthChanges,
    citationChanges,
    top,
    topDomainsByAi,
    themeSeries: { keys: seriesKeys, labels, points },
    breadth: {
      freshQuestions: new Set(fresh.map((a) => a.questionId)).size,
      freshAnswers: fresh.length,
      newShare: { entity: b.entity.newShare, theme: b.theme.newShare, domain: b.domain.newShare },
      rows: { entity: b.entity.rows, theme: b.theme.rows, domain: b.domain.rows },
    },
    alerts: input.alerts,
    recurring: input.recurring ?? [],
    marks: [...input.marks].sort((x, y) => x.at.getTime() - y.at.getTime()),
    band,
  };
}
