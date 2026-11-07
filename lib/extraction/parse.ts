import { z } from "zod";
import {
  ENTITY_TYPES,
  SENTIMENTS,
  SIDES,
  TONES,
  type EntityType,
  type ExtractionResult,
  type Sentiment,
  type Tone,
} from "./schema";

/** The extraction model's output didn't have the expected shape. */
export class ExtractionParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ExtractionParseError";
  }
}

/**
 * Name used to match the same thing across answers: lower case, no
 * accents or punctuation, single spaces, no leading "the".
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^the /, "");
}

/** An http(s) URL, cleaned of trailing punctuation, or null. */
export function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/[).,;:!?\]>'"]+$/, "");
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// Lenient: the strict schema should hold, but a stray value is cleaned
// rather than failing the whole extraction.
const text = z.string().transform((s) => s.trim().replace(/\s+/g, " "));
const rawSchema = z.object({
  tone: z.string().nullish(),
  framing: z.string().nullish(),
  entities: z
    .array(z.object({ name: text, type: z.string().nullish(), mentions: z.number().nullish(), url: z.unknown() }))
    .default([]),
  themes: z
    .array(
      z.object({ label: text, sentiment: z.string().nullish(), weight: z.number().nullish(), subTopic: z.string().nullish() })
    )
    .default([]),
  arguments: z.array(z.object({ side: z.string(), text, sourceUrl: z.unknown() })).default([]),
  sources: z.array(z.object({ name: text, url: z.unknown() })).default([]),
});

function oneOf<T extends string>(values: readonly T[], value: string | null | undefined): T | null {
  const v = value?.trim().toLowerCase();
  return (values as readonly string[]).includes(v ?? "") ? (v as T) : null;
}

/**
 * Parse the extraction model's output (a JSON string or object) into an
 * ExtractionResult. Entities and themes are merged by normalized name;
 * empty items are dropped; weights are clamped to 0–1; a sub-topic is kept
 * only if it matches one of `subTopics` (case-insensitive).
 */
export function parseExtraction(output: unknown, subTopics: string[] = []): ExtractionResult {
  let value = output;
  if (typeof output === "string") {
    try {
      value = JSON.parse(output);
    } catch (err) {
      throw new ExtractionParseError("Extraction output is not valid JSON", { cause: err });
    }
  }
  const parsed = rawSchema.safeParse(value);
  if (!parsed.success) {
    throw new ExtractionParseError(`Extraction output has the wrong shape: ${parsed.error.issues[0]?.message}`, {
      cause: parsed.error,
    });
  }
  const raw = parsed.data;

  const entities = new Map<string, ExtractionResult["entities"][number]>();
  for (const e of raw.entities) {
    const normalized = normalizeName(e.name);
    if (!normalized) continue;
    const mentions = Math.max(1, Math.round(e.mentions ?? 1));
    const url = cleanUrl(e.url);
    const existing = entities.get(normalized);
    if (existing) {
      existing.mentions += mentions;
      existing.url ??= url;
      continue;
    }
    const type: EntityType = oneOf(ENTITY_TYPES, e.type) ?? "other";
    entities.set(normalized, { name: e.name, normalized, type, mentions, url });
  }

  const subTopicByKey = new Map(subTopics.map((s) => [s.trim().toLowerCase(), s]));
  const themes = new Map<string, ExtractionResult["themes"][number]>();
  for (const t of raw.themes) {
    const normalized = normalizeName(t.label);
    if (!normalized || themes.has(normalized)) continue;
    const weight = typeof t.weight === "number" && Number.isFinite(t.weight) ? Math.min(1, Math.max(0, t.weight)) : null;
    themes.set(normalized, {
      label: t.label,
      normalized,
      sentiment: oneOf<Sentiment>(SENTIMENTS, t.sentiment),
      weight,
      subTopic: subTopicByKey.get(t.subTopic?.trim().toLowerCase() ?? "") ?? null,
    });
  }

  const seenArguments = new Set<string>();
  const args: ExtractionResult["arguments"] = [];
  for (const a of raw.arguments) {
    const side = oneOf(SIDES, a.side);
    const key = `${side}:${a.text.toLowerCase()}`;
    if (!side || !a.text || seenArguments.has(key)) continue;
    seenArguments.add(key);
    args.push({ side, text: a.text, sourceUrl: cleanUrl(a.sourceUrl) });
  }

  const seenSources = new Set<string>();
  const sources: ExtractionResult["sources"] = [];
  for (const s of raw.sources) {
    const url = cleanUrl(s.url);
    const key = url ?? normalizeName(s.name);
    if (!s.name || !key || seenSources.has(key)) continue;
    seenSources.add(key);
    sources.push({ name: s.name, url });
  }

  const framing = raw.framing?.trim().replace(/\s+/g, " ") || null;
  return {
    tone: oneOf<Tone>(TONES, raw.tone),
    framing,
    entities: [...entities.values()],
    themes: [...themes.values()],
    arguments: args,
    sources,
  };
}
