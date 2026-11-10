/**
 * The key a theme label is matched by (task 4.8): normalizeName, then each
 * word made singular. Deliberately small: it only folds spellings of the
 * same words ("Electricity Bills" = "electricity bill", "tax breaks" = "tax
 * break"). Different words ("power demand" vs "electricity demand") are the
 * vocabulary's and the label mapper's job, never this function's.
 */
import { normalizeName } from "@/lib/extraction/parse";

/** Words that end in "s" but aren't plurals, or whose singular we don't want. */
const KEEP = new Set([
  "gas", "news", "us", "bus", "status", "process", "access", "loss", "less", "business", "analysis", "basis",
  "crisis", "series", "species", "politics", "economics", "this", "has", "is", "was", "its", "plus",
  "texas", "kansas", "arkansas", "always", "across", "versus", "bonus", "census", "consensus", "focus", "virus",
]);

export function singular(word: string): string {
  if (word.length <= 3 || KEEP.has(word) || /(ss|us|is)$/.test(word)) return word;
  if (/ies$/.test(word)) return `${word.slice(0, -3)}y`;
  if (/(x|ch|sh|sses|zz)es$/.test(word)) return word.slice(0, -2);
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** Match key for a theme label; empty when nothing is left. */
export function themeKey(label: string): string {
  return normalizeName(label)
    .split(" ")
    .filter(Boolean)
    .map(singular)
    .join(" ");
}
