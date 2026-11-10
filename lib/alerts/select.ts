/**
 * Which of a snapshot's swings become alerts (task 5.2, PROJECT-PLAN §5B).
 * Pure: takes the comparison compareSnapshots() already made (every change
 * here is beyond its noise band) and decides what to say, in what order,
 * and what to roll into one "also changed" line.
 *
 * - One finding per idea: a finding that swung across all AIs and for some
 *   AIs on their own is one alert, naming those AIs. Tone and argument lean
 *   are one finding each (when "critical" rises, something else falls).
 * - Ranked by how far past its band it moved, with a lift for changes seen
 *   across all AIs and for things never seen before in this watch item, and
 *   a cut for changes that come from a model change rather than the world.
 * - Capped per snapshot; the rest go on the "also changed" line.
 */
import type { Metric, Swing } from "@/lib/snapshots";
import type { ProviderId } from "@/lib/answers";

/** Alerts per watch item per weekly or event snapshot. */
export const MAX_ALERTS_PER_SNAPSHOT = 3;
/** A model switch compares two models, not two weeks: one alert per item, labeled as a model change. */
export const MAX_ALERTS_PER_MODEL_SWITCH = 1;
/** Entries listed on the "also changed" line before "and N more". */
export const ALSO_CHANGED_LIMIT = 8;

const ALL_SCOPE_LIFT = 1.5;
const FIRST_SEEN_LIFT = 1.25;
const SEVERAL_AIS_LIFT = 1.2;
const MODEL_CHANGE_CUT = 0.5;

export type Trigger = "weekly" | "event" | "model_switch" | "manual";

export interface SelectContext {
  trigger: Trigger;
  /** AIs whose model differs between the two snapshots (always the switched one for a model switch). */
  modelChanged?: ProviderId[];
  /** `${metric}:${key}` of findings never seen in this watch item before the snapshot. */
  firstSeen?: Set<string>;
}

export interface Candidate {
  /** The swing the alert reports: across all AIs when that moved, else the AI that moved most. */
  swing: Swing;
  /** AIs that moved past their own band the same way. Empty when only the all-AI share did. */
  providers: ProviderId[];
  /** Every swing behind this finding (the all-AI one and each AI's). */
  related: Swing[];
  modelChange: boolean;
  firstSeen: boolean;
  score: number;
  rank: number;
}

export interface Selection {
  alerts: Candidate[];
  /** The ranked findings that didn't make the cap. */
  rest: Candidate[];
  /** One short line per finding in `rest`, for the "also changed" line. */
  alsoChanged: string[];
}

const ratio = (s: Swing) => Math.abs(s.change) / s.threshold;
const sign = (s: Swing) => Math.sign(s.change);

/** Findings that are one value per answer: a rise in one is a fall in another, so they're one finding. */
const ONE_PER_ANSWER: Metric[] = ["side", "tone"];

function groupKey(s: Swing): string {
  return ONE_PER_ANSWER.includes(s.metric) ? s.metric : `${s.metric}:${s.key}`;
}

export function selectAlerts(swings: Swing[], context: SelectContext): Selection {
  const modelChanged = new Set(context.modelChanged ?? []);
  const groups = new Map<string, Swing[]>();
  for (const s of swings) groups.set(groupKey(s), [...(groups.get(groupKey(s)) ?? []), s]);

  const candidates: Candidate[] = [];
  for (const group of groups.values()) {
    // Within tone or lean, the strongest key leads; within one key, the all-AI swing leads.
    const lead = [...group].sort((a, b) => Number(b.scope === "all") - Number(a.scope === "all") || ratio(b) - ratio(a))[0];
    const sameKey = group.filter((s) => s.key === lead.key && sign(s) === sign(lead));
    const providers = sameKey.filter((s) => s.scope !== "all").map((s) => s.scope as ProviderId).sort();
    const moved = lead.scope === "all" ? providers : providers.length ? providers : [lead.scope as ProviderId];
    // A model change explains it only when every AI that moved changed model (or only one AI moved and it did).
    const modelChange =
      context.trigger === "model_switch" || (lead.scope !== "all" && moved.length > 0 && moved.every((p) => modelChanged.has(p)));
    const firstSeen = lead.kind === "new" && !!context.firstSeen?.has(`${lead.metric}:${lead.key}`);
    let score = ratio(lead);
    if (lead.scope === "all") score *= ALL_SCOPE_LIFT;
    else if (moved.length > 1) score *= SEVERAL_AIS_LIFT;
    if (firstSeen) score *= FIRST_SEEN_LIFT;
    if (modelChange && context.trigger !== "model_switch") score *= MODEL_CHANGE_CUT;
    candidates.push({ swing: lead, providers: moved, related: group, modelChange, firstSeen, score, rank: 0 });
  }
  candidates.sort((a, b) => b.score - a.score || a.swing.key.localeCompare(b.swing.key));
  candidates.forEach((c, i) => (c.rank = i + 1));

  const cap = context.trigger === "model_switch" ? MAX_ALERTS_PER_MODEL_SWITCH : MAX_ALERTS_PER_SNAPSHOT;
  const alerts = candidates.slice(0, cap);
  const rest = candidates.slice(cap);
  const lines = rest.slice(0, ALSO_CHANGED_LIMIT).map(shortLine);
  if (rest.length > ALSO_CHANGED_LIMIT) lines.push(`and ${rest.length - ALSO_CHANGED_LIMIT} more`);
  return { alerts, rest, alsoChanged: lines };
}

export const pct = (share: number) => `${Math.round(share * 100)}%`;

const METRIC_NOUN: Record<Metric, string> = {
  entity: "name",
  theme: "theme",
  domain: "source",
  side: "argument lean",
  tone: "tone",
};

export function metricNoun(metric: Metric): string {
  return METRIC_NOUN[metric];
}

/** "ERCOT (name) rose 12% → 30%". */
export function shortLine(c: Candidate): string {
  const s = c.swing;
  const verb = s.kind === "new" ? "appeared" : s.kind === "gone" ? "dropped out" : s.kind;
  const who = s.scope === "all" ? "" : `, ${providerList(c.providers)}`;
  return `${findingLabel(s)} (${METRIC_NOUN[s.metric]}${who}) ${verb} ${pct(s.before)} → ${pct(s.after)}${c.modelChange ? " [model change]" : ""}`;
}

const SIDE_LABELS: Record<string, string> = {
  "leans for": "answers leaning for",
  "leans against": "answers leaning against",
  even: "evenly balanced answers",
  "no arguments": "answers with no arguments either way",
};

/** How a finding reads in a sentence. */
export function findingLabel(s: Pick<Swing, "metric" | "label" | "key">): string {
  if (s.metric === "tone") return `${s.label} tone`;
  if (s.metric === "side") return SIDE_LABELS[s.key] ?? s.label;
  return s.label;
}

const AI_NAMES: Record<string, string> = { claude: "Claude", openai: "ChatGPT", gemini: "Gemini", grok: "Grok" };

export function aiName(p: string): string {
  return AI_NAMES[p] ?? p;
}

export function providerList(ps: string[]): string {
  const names = ps.map(aiName);
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
