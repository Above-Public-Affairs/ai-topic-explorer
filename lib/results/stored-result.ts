import { z } from "zod";
import type { AnalysisResult } from "@/lib/types";

/**
 * Shape version written into every saved result. Results saved before this
 * field existed have none and read as version 1.
 *
 * v1: Feb–Nov 2026. May carry a Perplexity response, `NaN`-turned-null Grok
 *     frequencies, or fields missing from early runs.
 * v2: Nov 2026. Adds `schemaVersion`; `model` can list several models.
 */
export const RESULT_SCHEMA_VERSION = 2;

const STORED_PROVIDERS = ["claude", "openai", "gemini", "grok", "perplexity"] as const;

/**
 * An array where each bad item is dropped rather than failing the whole list.
 * Saved results are read for months after they're written, so one malformed
 * entry should cost that entry, not the page.
 */
function lenientArray<T extends z.ZodType>(item: T) {
  return z
    .array(z.unknown())
    .catch([])
    .default([])
    .transform((items) =>
      items.flatMap((value) => {
        const parsed = item.safeParse(value);
        return parsed.success ? [parsed.data as z.output<T>] : [];
      })
    );
}

const text = z.string().trim().min(1);
/** A number, or a numeric string; anything else (null, "high", NaN) → fallback. */
const finiteNumber = (fallback: number) =>
  z.unknown().transform((value) => {
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim()
          ? Number(value)
          : NaN;
    return Number.isFinite(n) ? n : fallback;
  });

const providerList = lenientArray(z.enum(STORED_PROVIDERS));

const entity = z.object({
  name: text,
  url: z.string().optional().catch(undefined),
  providers: providerList.optional(),
});

const entities = z
  .object({ people: lenientArray(entity), organizations: lenientArray(entity) })
  .catch({ people: [], organizations: [] })
  .default({ people: [], organizations: [] });

const keyTheme = z.object({
  phrase: text,
  relevance: finiteNumber(3),
});

const quotedPhrase = z.object({
  phrase: text,
  frequency: finiteNumber(3).transform((n) => Math.min(5, Math.max(1, Math.round(n)))),
});

const tokenUsage = z.object({
  inputTokens: finiteNumber(0),
  outputTokens: finiteNumber(0),
  purpose: z.enum(["expansion", "analysis"]).catch("analysis"),
});

const response = z.object({
  rawText: z.string().catch(""),
  entities,
  citations: lenientArray(
    z
      .object({ title: z.string().catch(""), url: text })
      .transform((c) => ({ ...c, title: c.title || c.url }))
  ),
  keyThemes: lenientArray(keyTheme),
  model: z.string().catch(""),
  usage: lenientArray(tokenUsage).optional(),
  quotedPhrases: lenientArray(quotedPhrase).optional(),
});

/** A provider's response, or null when it's missing or unreadable. */
function providerResponse(provider: "claude" | "openai" | "gemini" | "grok") {
  return response
    .transform((r) => ({ ...r, provider }))
    .nullable()
    .catch(null)
    .default(null);
}

const storedResult = z.object({
  schemaVersion: z.number().int().catch(1).default(1),
  topic: z.string().trim().catch(""),
  expandedQueries: lenientArray(text),
  // Perplexity (removed Nov 2026) is dropped here: nothing shows it any more.
  responses: z
    .object({
      claude: providerResponse("claude"),
      openai: providerResponse("openai"),
      gemini: providerResponse("gemini"),
      grok: providerResponse("grok"),
    })
    .catch({ claude: null, openai: null, gemini: null, grok: null })
    .default({ claude: null, openai: null, gemini: null, grok: null }),
  errors: z
    .object({
      claude: z.string().optional().catch(undefined),
      openai: z.string().optional().catch(undefined),
      gemini: z.string().optional().catch(undefined),
      grok: z.string().optional().catch(undefined),
    })
    .catch({})
    .default({}),
  combinedWordFrequencies: lenientArray(
    z.object({ word: text, count: finiteNumber(1) })
  ),
  combinedKeyThemes: lenientArray(keyTheme),
  combinedEntities: entities,
  combinedCitations: lenientArray(
    z
      .object({
        title: z.string().catch(""),
        url: text,
        domain: z.string().catch(""),
        providers: providerList,
      })
      .transform((c) => ({ ...c, title: c.title || c.url }))
  ),
  tokenUsage: lenientArray(tokenUsage),
});

export type StoredResultRead =
  | { ok: true; result: AnalysisResult }
  | { ok: false; reason: string };

/**
 * Read a saved result of any version into the current shape, filling defaults
 * for anything missing or malformed. Fails only when there's nothing worth
 * showing: no topic, or no provider answered.
 */
export function readStoredResult(raw: unknown): StoredResultRead {
  const parsed = storedResult.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "not an object" };
  const result = parsed.data as AnalysisResult;
  if (!result.topic) return { ok: false, reason: "no topic" };
  if (!Object.values(result.responses).some(Boolean)) {
    return { ok: false, reason: "no provider responses" };
  }
  return { ok: true, result };
}
