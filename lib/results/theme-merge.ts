/**
 * Near-duplicate theme merging for the public results page. Each AI's
 * extraction names its themes in its own words, so one run can produce
 * "Technical hurdles", "Technical challenges" and "Technical progress and
 * hurdles" side by side. Those are one idea; this folds them together so the
 * Key Themes cloud shows distinct ideas and sizes them by real agreement.
 *
 * Deterministic and cheap (no model call): a theme's "core" is its words
 * minus the topic's own words, filler, and generic facet nouns
 * ("challenges", "viability"), with a few synonyms folded ("commercial" →
 * "economic"). Two themes merge when one core contains the other plus at
 * most one more word.
 */

const STOP = new Set([
  "a", "an", "and", "the", "of", "in", "on", "for", "to", "with", "by", "vs", "versus", "its", "their", "at", "from", "or",
]);

/** Nouns that say what kind of point it is, not what it's about. */
const FACETS = new Set([
  "aspect", "barrier", "challenge", "concern", "consideration", "debate", "factor", "feasibility", "hurdle", "implication",
  "issue", "obstacle", "outlook", "potential", "progress", "prospect", "question", "uncertainty", "viability",
]);

/** Words that mean the same thing for grouping purposes. */
const SYNONYMS: Record<string, string> = {
  commercial: "economic",
  economics: "economic",
  economy: "economic",
  financial: "economic",
  finance: "economic",
  technological: "technical",
  technology: "technical",
  regulatory: "regulation",
  regulations: "regulation",
  legal: "regulation",
  environmental: "environment",
  ecological: "environment",
};

function stem(word: string): string {
  const w = SYNONYMS[word] ?? word;
  if (SYNONYMS[w]) return SYNONYMS[w];
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) return SYNONYMS[w.slice(0, -1)] ?? w.slice(0, -1);
  return w;
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
}

/** The words that carry a theme's meaning, stemmed. Empty when it's all filler. */
export function themeCore(label: string, topicWords: Set<string>): Set<string> {
  const core = new Set<string>();
  for (const w of words(label)) {
    if (STOP.has(w)) continue;
    const s = stem(w);
    if (topicWords.has(s) || topicWords.has(w) || FACETS.has(s)) continue;
    core.add(s);
  }
  return core;
}

/** Stemmed topic words, so "Asteroid mining feasibility" drops "asteroid" and "mining" from its themes. */
export function topicCoreWords(topic: string): Set<string> {
  const out = new Set<string>();
  for (const w of words(topic)) {
    if (STOP.has(w)) continue;
    out.add(w);
    out.add(stem(w));
  }
  return out;
}

function subsetOf(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (!b.has(w)) return false;
  return true;
}

/**
 * Same idea: one core holds the other and adds at most one word. "Supply" and
 * "Supply expansion" merge; "Resource" and "Space resource law" don't, since
 * two extra words usually make it a different point.
 */
function nearDuplicate(a: Set<string>, b: Set<string>): boolean {
  if (a.size === 0 || b.size === 0) return false;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return big.size - small.size <= 1 && subsetOf(small, big);
}

/**
 * Group items whose labels are near-duplicates. Items should arrive best
 * first: each group is led by its first item, whose label it keeps. An item
 * joins a group when its core is a near-duplicate of the core of any item
 * already in it. Items with an empty core never merge.
 */
export function groupNearDuplicates<T>(items: T[], label: (t: T) => string, topic: string): T[][] {
  const topicWords = topicCoreWords(topic);
  const groups: { cores: Set<string>[]; items: T[] }[] = [];
  for (const item of items) {
    const core = themeCore(label(item), topicWords);
    const group =
      core.size === 0
        ? undefined
        : groups.find((g) => g.cores.some((c) => nearDuplicate(c, core)));
    if (group) {
      group.items.push(item);
      group.cores.push(core);
    } else {
      groups.push({ cores: [core], items: [item] });
    }
  }
  return groups.map((g) => g.items);
}
