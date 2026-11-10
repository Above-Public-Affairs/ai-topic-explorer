/**
 * The facts an alert is written from (task 5.2): the finding in plain
 * numbers, which AIs, short quotes from the answers with their sources, how
 * the AIs were asked, and what else changed. Stored on Alert.facts, and the
 * only thing the summary writer sees, so every number it may use is here.
 */
import type { Metric, Swing } from "@/lib/snapshots";
import { aiName, findingLabel, metricNoun, pct, providerList, type Candidate, type Trigger } from "./select";

export interface EvidenceQuote {
  ai: string;
  /** "1.3": question set 1, question 3. */
  question: string;
  quote: string;
  sourceUrl?: string;
  sourceTitle?: string;
}

export interface AlertFacts {
  watchItem: string;
  topic: string;
  /** "Asked as a user in Austin, Texas". */
  askedAs: string;
  trigger: Trigger;
  /** What kind of comparison this is, in words. */
  comparedAs: string;
  event?: { title: string; date: string; sourceUrl?: string };
  modelSwitch?: { ai: string; oldModel: string; newModel: string };
  finding: {
    metric: Metric;
    /** "name", "theme", "source", "tone", "argument lean". */
    kind: string;
    label: string;
    direction: "rose" | "fell" | "new" | "gone";
    /** "all four AIs" or "Grok". */
    who: string;
    before: string;
    after: string;
    answersBefore: string;
    answersAfter: string;
    /** How far it moved, in points. */
    moved: string;
    /** The usual wobble between repeated asks it beat, in points. */
    usualWobble: string;
    firstSeen: boolean;
  };
  /** The same finding per AI, where each AI's own share is known. */
  perAi: { ai: string; before: string; after: string; pastOwnBand: boolean }[];
  /** Plain-English caveat when a model change, not the world, may explain it. */
  modelCaveat?: string;
  dates: { before: string; after: string };
  evidence: EvidenceQuote[];
  alsoChanged: string[];
}

export interface FactsInput {
  candidate: Candidate;
  watchItem: { name: string; topic: string };
  run: { askCity: string | null; askRegion: string | null; askCountry: string | null; startedAt: Date };
  beforeRun?: { startedAt: Date } | null;
  trigger: Trigger;
  providersInRun: string[];
  /** Per-AI shares of this finding (from the comparison's per-AI swings, or computed). */
  perAi: { provider: string; before: number; after: number; pastOwnBand: boolean }[];
  event?: { title: string; occurredAt: Date; sourceUrl: string | null } | null;
  modelSwitch?: { provider: string; oldModel: string; newModel: string } | null;
  /** AIs whose model changed between the two snapshots (weekly and event runs). */
  modelChanged: string[];
  evidence: EvidenceQuote[];
  alsoChanged: string[];
}

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" });
const DATE_TIME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago", timeZoneName: "short" });
export const formatDate = (d: Date) => DATE.format(d);

/** Snapshot dates, with times when both fall on one day. */
export function snapshotDates(before: Date, after: Date): { before: string; after: string } {
  const a = formatDate(before);
  const b = formatDate(after);
  return a === b ? { before: DATE_TIME.format(before), after: DATE_TIME.format(after) } : { before: a, after: b };
}

/** "Asked as a user in Austin, Texas" (PROJECT-PLAN, "Promote the location detail"). */
export function askedAs(run: { askCity: string | null; askRegion: string | null; askCountry: string | null }): string {
  const parts = [run.askCity, run.askRegion].filter((p): p is string => !!p?.trim());
  if (run.askCountry && run.askCountry !== "US") parts.push(run.askCountry);
  return parts.length ? `Asked as a user in ${parts.join(", ")}` : "Asked with no user location";
}

const points = (share: number) => `${Math.round(Math.abs(share) * 100)} points`;
const answers = (n: number) => `${n} ${n === 1 ? "answer" : "answers"}`;

export function whoMoved(c: Candidate, providersInRun: string[]): string {
  if (c.swing.scope !== "all") return providerList(c.providers);
  const n = providersInRun.length;
  const word = ["", "one", "two", "three", "four", "five"][n] ?? String(n);
  return n === 1 ? aiName(providersInRun[0]) : `all ${word} AIs together`;
}

export function buildFacts(input: FactsInput): AlertFacts {
  const s: Swing = input.candidate.swing;
  const dates =
    input.trigger === "model_switch" && input.modelSwitch
      ? { before: `old model (${input.modelSwitch.oldModel})`, after: `new model (${input.modelSwitch.newModel})` }
      : snapshotDates(input.beforeRun?.startedAt ?? input.run.startedAt, input.run.startedAt);
  const comparedAs =
    input.trigger === "model_switch"
      ? `the same questions asked of ${aiName(input.modelSwitch?.provider ?? "")}'s old and new model on ${formatDate(input.run.startedAt)}`
      : `the ${dates.after} snapshot${input.trigger === "event" ? " (run after a news event)" : ""} against the one from ${dates.before}`;
  const changedHere = input.modelChanged.filter((p) => s.scope === "all" || input.candidate.providers.includes(p as never));
  let modelCaveat: string | undefined;
  if (input.trigger === "model_switch" && input.modelSwitch) {
    modelCaveat = `This is a model change, not a change in the world: ${aiName(input.modelSwitch.provider)} switched its default model from ${input.modelSwitch.oldModel} to ${input.modelSwitch.newModel}, and the same questions were asked of both.`;
  } else if (changedHere.length) {
    modelCaveat = `${providerList(changedHere)} answered with a different model in the two snapshots, so part of this may be the new model rather than a change in the world.`;
  }
  return {
    watchItem: input.watchItem.name,
    topic: input.watchItem.topic,
    askedAs: askedAs(input.run),
    trigger: input.trigger,
    comparedAs,
    ...(input.event ? { event: { title: input.event.title, date: formatDate(input.event.occurredAt), ...(input.event.sourceUrl ? { sourceUrl: input.event.sourceUrl } : {}) } } : {}),
    ...(input.modelSwitch ? { modelSwitch: { ai: aiName(input.modelSwitch.provider), oldModel: input.modelSwitch.oldModel, newModel: input.modelSwitch.newModel } } : {}),
    finding: {
      metric: s.metric,
      kind: metricNoun(s.metric),
      label: findingLabel(s),
      direction: s.kind,
      who: whoMoved(input.candidate, input.providersInRun),
      before: pct(s.before),
      after: pct(s.after),
      answersBefore: answers(s.countBefore),
      answersAfter: answers(s.countAfter),
      moved: points(s.change),
      usualWobble: points(s.threshold),
      firstSeen: input.candidate.firstSeen,
    },
    perAi: input.perAi.map((p) => ({ ai: aiName(p.provider), before: pct(p.before), after: pct(p.after), pastOwnBand: p.pastOwnBand })),
    ...(modelCaveat ? { modelCaveat } : {}),
    dates,
    evidence: input.evidence,
    alsoChanged: input.alsoChanged,
  };
}

/** The sentence in an answer that mentions any of the terms, trimmed to a short quote. */
export function quoteFor(text: string, terms: string[], maxLength = 240): string | null {
  const clean = text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links → their text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#>`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = clean.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [];
  const wanted = terms.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 3);
  for (const raw of sentences) {
    const sentence = raw.trim();
    const lower = sentence.toLowerCase();
    if (sentence.length < 30) continue;
    if (!wanted.some((t) => lower.includes(t))) continue;
    if (sentence.length <= maxLength) return sentence;
    const at = Math.max(0, ...wanted.map((t) => lower.indexOf(t)).filter((i) => i >= 0));
    const start = Math.max(0, Math.min(at - 80, sentence.length - maxLength));
    const cut = sentence.slice(start, start + maxLength).trim();
    return `${start > 0 ? "…" : ""}${cut}…`;
  }
  return null;
}
