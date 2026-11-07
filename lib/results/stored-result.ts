import { z } from "zod";
import type { AnalysisResult } from "@/lib/types";

/**
 * Shape version written into every saved result. Results saved before this
 * field existed have none and read as version 1.
 *
 * v1: Feb–Nov 2026. May carry a Perplexity response, `NaN`-turned-null Grok
 *     frequencies, or fields missing from early runs.
 * v2: Nov 2026. Adds `schemaVersion`; `model` can list several models.
 * v3: Nov 2026, the new pipeline (§2D). Only `{ schemaVersion, topic, runId }`:
 *     the answers, sources and extraction live in the Run tables and are read
 *     by lib/results/run-view.ts. Read with `readRunPointer`.
 */
export const RESULT_SCHEMA_VERSION = 3;

/** The last version stored as one JSON blob (the `AnalysisResult` shape). */
export const LEGACY_RESULT_SCHEMA_VERSION = 2;

/** What a v3 result stores: a pointer to its pipeline run. */
export interface RunPointer {
  schemaVersion: 3;
  topic: string;
  runId: string;
}

export function runPointer(topic: string, runId: string): RunPointer {
  return { schemaVersion: RESULT_SCHEMA_VERSION, topic, runId };
}

/** The run a saved result points to, or null for a v1/v2 blob. */
export function readRunPointer(raw: unknown): RunPointer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { schemaVersion, topic, runId } = raw as Record<string, unknown>;
  if (typeof schemaVersion !== "number" || schemaVersion < 3) return null;
  if (typeof runId !== "string" || !runId) return null;
  return { schemaVersion: 3, topic: typeof topic === "string" ? topic : "", runId };
}

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
