/**
 * Plain-English wording for the monthly report (Josh, 2026-11-10: "more high
 * level for average people to understand"). Shares are said as "about 6 in
 * 10 answers", and no sentence uses the report's internal terms (noise band,
 * locked questions, entities, domains).
 */
import { providerLabel } from "@/lib/providers";
import type { Swing } from "@/lib/snapshots";
import type { ItemReport, TimelineMark } from "./types";

/** "about 6 in 10", "almost none", "nearly all". */
export function inTen(share: number): string {
  if (share < 0.05) return "almost none";
  if (share > 0.95) return "nearly all";
  return `about ${Math.round(share * 10)} in 10`;
}

const lower = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
/** Domains read as names: "reddit.com" → "Reddit" is guesswork, so keep the domain but drop "www.". */
const site = (d: string) => d.replace(/^www\./, "");

/** Who said it: "AI answers" across all four, or "Gemini's answers". */
function whose(scope: Swing["scope"]): string {
  return scope === "all" ? "The AIs" : providerLabel(scope);
}

/**
 * One change as a sentence a non-specialist can read:
 * "The AIs talk about water use more: about 6 in 10 answers, up from about 4 in 10."
 */
export function plainChange(w: Swing): string {
  const up = w.after > w.before;
  const now = w.after < 0.05 ? "almost no answers" : w.after > 0.95 ? "nearly all answers" : `${inTen(w.after)} answers`;
  const tail = `${now} now, ${up ? "up" : "down"} from ${inTen(w.before)}.`;
  switch (w.metric) {
    case "theme":
      return `${whose(w.scope)} ${w.scope === "all" ? "talk" : "talks"} about ${lower(w.label)} ${up ? "more" : "less"}: ${tail}`;
    case "entity":
      return `${w.label} comes up ${up ? "more" : "less"}${w.scope === "all" ? "" : ` in ${providerLabel(w.scope)}'s answers`}: ${tail}`;
    case "domain":
      return `${whose(w.scope)} ${w.scope === "all" ? "point" : "points"} to ${site(w.label)} as a source ${up ? "more" : "less"}: ${tail}`;
    case "tone":
      return `${up ? "More" : "Fewer"} answers${w.scope === "all" ? "" : ` from ${providerLabel(w.scope)}`} sound ${w.label}: ${tail}`;
    case "side": {
      const what = w.label === "leans against" ? "argue against" : w.label === "leans for" ? "argue in favor" : w.label === "even" ? "give both sides equally" : "make no argument either way";
      return `${up ? "More" : "Fewer"} answers${w.scope === "all" ? "" : ` from ${providerLabel(w.scope)}`} ${what}: ${tail}`;
    }
  }
}

/**
 * The few changes worth a reader's time, biggest first: across all AIs before
 * one AI, and one sentence per finding (a source that moved overall and for one
 * AI is said once, overall).
 */
export function headlineChanges(r: ItemReport, max = 3): Swing[] {
  const all = [...r.depthChanges, ...r.citationChanges];
  const ranked = [...all].sort((a, b) => Number(b.scope === "all") - Number(a.scope === "all") || Math.abs(b.change) - Math.abs(a.change));
  const seen = new Set<string>();
  const out: Swing[] = [];
  for (const w of ranked) {
    const id = `${w.metric}|${w.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(w);
    if (out.length === max) break;
  }
  return out;
}

/** "Most answers mention electricity demand, grid reliability and water use." */
export function steadyLine(r: ItemReport): string {
  const top = r.top.theme.slice(0, 3).map((t) => lower(t.label));
  if (!top.length) return "";
  const list = top.length > 1 ? `${top.slice(0, -1).join(", ")} and ${top.at(-1)}` : top[0];
  return `The topics that come up most: ${list}.`;
}

/** New subjects the month's new questions raised, as plain names (no web addresses). */
export function newTopics(r: ItemReport, max = 3): string[] {
  return [...r.breadth.rows.theme, ...r.breadth.rows.entity].sort((a, b) => b.count - a.count).slice(0, max).map((b) => lower(b.label));
}

export function plainMark(m: TimelineMark): string {
  if (m.kind === "new_model") return m.label.replace(/^(Sample: )?[Nn]ew (\w+) default: (.+)$/, (_, s = "", p: string, model: string) => `${s}${providerLabel(p)} switched the free version to a new model (${model})`);
  if (m.kind === "model_switch") return "We asked the same questions on the old and new model to see what the switch changed";
  return m.label;
}
