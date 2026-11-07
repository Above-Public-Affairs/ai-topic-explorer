import type { Provider } from "@/lib/types";
import { providerLabel } from "@/lib/providers";

export interface WordContextMatch {
  provider: Provider;
  providerLabel: string;
  excerpts: string[];
}

/**
 * Find sentences containing a given word/phrase across all provider texts.
 * For multi-word phrases, uses fuzzy matching: sentences are scored by how
 * many of the individual words they contain and ranked by relevance.
 * Returns up to `maxExcerpts` best-matching sentences per provider.
 */
export function findWordContext(
  word: string,
  providerTexts: Record<string, string>,
  maxExcerpts = 3
): WordContextMatch[] {
  const results: WordContextMatch[] = [];
  const words = word
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 0);

  // Build a regex for each individual word
  const wordRegexes = words.map(
    (w) => new RegExp(`\\b${escapeRegex(w)}\\b`, "gi")
  );

  // Also try exact phrase match
  const exactRegex = new RegExp(`\\b${escapeRegex(word.toLowerCase())}\\b`, "gi");

  for (const [provider, text] of Object.entries(providerTexts)) {
    const sentences = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Score each sentence by how many query words it contains
    const scored: { sentence: string; score: number; exact: boolean }[] = [];

    for (const sentence of sentences) {
      const sentenceLower = sentence.toLowerCase();

      // Check for exact phrase match first
      exactRegex.lastIndex = 0;
      const isExact = exactRegex.test(sentenceLower);

      // Count how many individual words match
      let matchCount = 0;
      for (const regex of wordRegexes) {
        regex.lastIndex = 0;
        if (regex.test(sentenceLower)) matchCount++;
      }

      // Require at least half the words to match (minimum 1)
      const minWords = Math.max(1, Math.ceil(words.length / 2));
      if (matchCount >= minWords) {
        scored.push({ sentence, score: matchCount, exact: isExact });
      }
    }

    // Sort: exact matches first, then by word count (descending)
    scored.sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      return b.score - a.score;
    });

    const topExcerpts = scored.slice(0, maxExcerpts).map((s) => s.sentence);

    if (topExcerpts.length > 0) {
      results.push({
        provider: provider as Provider,
        providerLabel: providerLabel(provider),
        excerpts: topExcerpts,
      });
    }
  }

  return results;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
