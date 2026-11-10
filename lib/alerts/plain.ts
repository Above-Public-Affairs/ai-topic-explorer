/**
 * The alert in words anyone can read (Josh, Nov 10, 2026: "needs to be
 * simpler and clear what is being communicated"). Built from the numbers
 * alone, no AI call: "Gemini's new model cites reddit.com in about 1 in 10
 * answers, down from 5 in 10 with the old one." Shares are said as "N in 10";
 * percentages and noise bands stay in the email's small details line.
 */
import type { Metric, Swing } from "@/lib/snapshots";
import { aiName, providerList } from "./select";

/** "about 1 in 10 answers", "5 in 10 answers", "no answers", "every answer". */
export function plainShare(share: number, withNoun = true): string {
  const noun = withNoun ? " answers" : "";
  if (share <= 0) return withNoun ? "no answers" : "none";
  if (share >= 1) return withNoun ? "every answer" : "all";
  const tenths = share * 10;
  const n = Math.round(tenths);
  if (n === 0) return `fewer than 1 in 10${noun}`;
  if (n === 10) return withNoun ? "almost every answer" : "almost all";
  return `${Math.abs(tenths - n) < 0.05 ? "" : "about "}${n} in 10${noun}`;
}

const SIDE: Record<string, { one: string; many: string }> = {
  "leans for": { one: "argues mostly in favor", many: "argue mostly in favor" },
  "leans against": { one: "argues mostly against", many: "argue mostly against" },
  even: { one: "gives both sides evenly", many: "give both sides evenly" },
  "no arguments": { one: "makes no argument either way", many: "make no argument either way" },
};

/** The verb phrase with its object: "cites reddit.com", "mention ERCOT", "take a critical tone". */
function action(metric: Metric, key: string, label: string, singular: boolean): string {
  const v = (one: string, many: string) => (singular ? one : many);
  if (metric === "entity") return `${v("mentions", "mention")} ${label}`;
  if (metric === "theme") return `${v("brings", "bring")} up ${label.toLowerCase()}`;
  if (metric === "domain") return `${v("cites", "cite")} ${label}`;
  if (metric === "tone") return `${v("takes", "take")} a ${label} tone`;
  const side = SIDE[key];
  return side ? (singular ? side.one : side.many) : `${v("leans", "lean")} ${label}`;
}

export interface PlainInput {
  swing: Swing;
  /** AIs that moved on their own (Candidate.providers). */
  providers: string[];
  modelSwitch?: { provider: string; newModel: string } | null;
  /** The earlier snapshot's date, for "on Nov 9". */
  beforeDate: string;
}

export interface Plain {
  /** One sentence: what changed. */
  headline: string;
  /** For the subject line: "Gemini's new model cites reddit.com less". */
  short: string;
}

export function plainChange(input: PlainInput): Plain {
  const s = input.swing;
  const ms = input.modelSwitch;
  let who: string;
  let singular: boolean;
  if (ms) {
    who = `${aiName(ms.provider)}'s new model`;
    singular = true;
  } else if (s.scope === "all") {
    who = input.providers.length === 1 ? aiName(input.providers[0]) : "The AIs";
    singular = input.providers.length === 1;
  } else {
    const ps = input.providers.length ? input.providers : [s.scope];
    who = providerList(ps);
    singular = ps.length === 1;
  }
  const act = action(s.metric, s.key, s.label, singular);
  const up = s.change > 0;
  const since = ms ? "with the old one" : `on ${input.beforeDate}`;
  const from = plainShare(s.before, false);
  // "Gemini's new model now cites…" says "new" twice.
  const now = ms ? "" : " now";
  const headline =
    s.after <= 0
      ? `${who} no longer ${act}; ${ms ? "the old model did" : singular ? "it did" : "they did"} in ${plainShare(s.before)}${ms ? "" : ` ${since}`}.`
      : s.before <= 0
        ? `${who}${now} ${act} in ${plainShare(s.after)}, up from none ${since}.`
        : `${who}${now} ${act} in ${plainShare(s.after)}, ${up ? "up" : "down"} from ${from} ${since}.`;
  const short = `${who} ${act} ${up ? "more" : "less"}${ms ? " (model change)" : ""}`;
  return { headline, short };
}

/** Plain words for a model change: why this isn't news about the world. */
export function plainModelNote(input: { modelSwitch?: { provider: string; newModel: string } | null; modelChanged: string[] }): string | undefined {
  if (input.modelSwitch) {
    return `${aiName(input.modelSwitch.provider)} switched to a new model (${input.modelSwitch.newModel}). This shows how the new model answers differently, not a change in the world.`;
  }
  if (input.modelChanged.length) {
    return `${providerList(input.modelChanged)} answered with a new model this time, so part of this may just be the new model.`;
  }
  return undefined;
}
