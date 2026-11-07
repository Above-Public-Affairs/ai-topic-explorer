import { mergeEntities } from "@/lib/analysis/merge-entities";
import { mergeKeyThemes } from "@/lib/analysis/merge-themes";
import type { AIResponse } from "@/lib/types";

/**
 * Grok's quoted-phrase frequency is model-authored. A string like "high"
 * made `Math.max(1, ...)` return NaN, which then sorted unpredictably and
 * saved as null. Keep it a whole number from 1 to 5.
 */
export function clampFrequency(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 3;
}

/** Merge multiple AIResponses from subtopic queries into a single AIResponse per provider */
export function mergeProviderResponses(responses: AIResponse[]): AIResponse {
  const rawTexts = responses.map((r) => r.rawText);
  const provider = responses[0].provider;
  const allEntities = responses.map((r) => ({ provider, entities: r.entities }));
  const allCitations = responses.flatMap((r) => r.citations);
  const allKeyThemes = responses.map((r) => r.keyThemes);
  const allUsage = responses.flatMap((r) => r.usage || []);
  const allQuotedPhrases = [
    ...new Map(
      responses
        .flatMap((r) => r.quotedPhrases || [])
        .filter((q) => typeof q?.phrase === "string" && q.phrase.trim())
        .map((q) => [q.phrase.toLowerCase(), { ...q, frequency: clampFrequency(q.frequency) }] as const)
    ).values(),
  ]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 15);

  return {
    provider,
    rawText: rawTexts.join("\n\n"),
    entities: mergeEntities(allEntities),
    citations: allCitations,
    keyThemes: mergeKeyThemes(...allKeyThemes),
    // Gemini can answer some subtopic queries on its fallback model, so name
    // every model that answered, not just the first.
    model: [...new Set(responses.map((r) => r.model))].join(", "),
    usage: allUsage,
    ...(allQuotedPhrases.length > 0 && { quotedPhrases: allQuotedPhrases }),
  };
}
