/**
 * The one fixed extraction pass (§2B): its model, prompt version and the
 * structured output it returns. Only the extraction model is asked for
 * structured output; provider answers stay plain prose.
 */

import { EXTRACTION_DEFAULT } from "@/lib/answers/registry";

/**
 * The built-in extraction model, used only when the model list can't be
 * read. The live choice is the ModelRegistry row with role "extraction"
 * (getExtractionModel(), task 2.7); this is its seed, EXTRACTION_DEFAULT.
 */
export const EXTRACTION_MODEL = EXTRACTION_DEFAULT.model;
/** Provider whose price rows apply to EXTRACTION_MODEL. */
export const EXTRACTION_PROVIDER = "openai" as const;

/**
 * Bump whenever the prompt or schema changes, so stored extractions stay
 * comparable (Extraction.promptVersion).
 */
export const PROMPT_VERSION = "2026-11-07.3";

export const TONES = ["positive", "neutral", "mixed", "critical"] as const;
export const ENTITY_TYPES = ["person", "organization", "place", "legislation", "other"] as const;
export const SENTIMENTS = ["positive", "negative", "neutral", "mixed"] as const;
export const SIDES = ["for", "against"] as const;

export type Tone = (typeof TONES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];
export type Sentiment = (typeof SENTIMENTS)[number];
export type Side = (typeof SIDES)[number];

/** The extraction, cleaned and de-duplicated (see parse.ts). */
export interface ExtractionResult {
  tone: Tone | null;
  framing: string | null;
  entities: {
    name: string;
    normalized: string;
    type: EntityType;
    mentions: number;
    url: string | null;
    /** The model's full name for it when that differs from `name` ("ERCOT" → "Electric Reliability Council of Texas"). */
    canonicalName: string | null;
  }[];
  themes: {
    label: string;
    normalized: string;
    sentiment: Sentiment | null;
    weight: number | null;
    /** One of the sub-topic names passed in, exactly as given, or null. */
    subTopic: string | null;
  }[];
  arguments: { side: Side; text: string; sourceUrl: string | null }[];
  /** Sources the answer names or attributes claims to. */
  sources: { name: string; url: string | null }[];
}

const nullableString = { type: ["string", "null"] } as const;

/** JSON schema for OpenAI structured outputs (strict mode: every key required). */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tone", "framing", "entities", "themes", "arguments", "sources"],
  properties: {
    tone: {
      type: "string",
      enum: [...TONES],
      description: "The answer's overall stance toward the industry or topic.",
    },
    framing: {
      type: "string",
      description: "One or two sentences on how the answer frames the industry or topic.",
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "canonicalName", "type", "mentions", "url"],
        properties: {
          name: { type: "string", description: "The name exactly as the answer writes it." },
          canonicalName: {
            type: "string",
            description:
              "Its full official name, with acronyms and short forms spelled out, when the answer makes clear what it is " +
              "(ERCOT → Electric Reliability Council of Texas; Texas PUC → Public Utility Commission of Texas). Otherwise the name as written.",
          },
          type: { type: "string", enum: [...ENTITY_TYPES] },
          mentions: { type: "integer", description: "Times the answer names it." },
          url: { ...nullableString, description: "A URL the answer gives for it, or null." },
        },
      },
    },
    themes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "sentiment", "weight", "subTopic"],
        properties: {
          label: { type: "string", description: "A short noun phrase, 1-4 words." },
          sentiment: { type: "string", enum: [...SENTIMENTS] },
          weight: { type: "number", description: "Share of the answer about this theme, 0-1." },
          subTopic: { ...nullableString, description: "The listed sub-topic this theme belongs to, or null." },
        },
      },
    },
    arguments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["side", "text", "sourceUrl"],
        properties: {
          side: {
            type: "string",
            enum: [...SIDES],
            description: "for: favorable to the industry or topic. against: critical of it.",
          },
          text: { type: "string", description: "The argument in one sentence." },
          sourceUrl: { ...nullableString, description: "URL the answer attributes it to, or null." },
        },
      },
    },
    sources: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "url"],
        properties: {
          name: { type: "string", description: "Outlet, agency, report or person cited." },
          url: nullableString,
        },
      },
    },
  },
} as const;
