import type { Entity, ExtractedEntities, Citation, KeyTheme } from "@/lib/types";

/**
 * Retry budget for a single provider request, on top of the SDK default of 2.
 * The OpenAI-compatible SDKs retry 429/5xx with exponential backoff and honor
 * the response's `retry-after`, so the extra attempts let a transient rate
 * limit clear instead of killing the subtopic query outright. The caller's
 * timeout signal aborts mid-retry, so this can't extend a request past its
 * deadline.
 */
export const REQUEST_MAX_RETRIES = 4;

export const PROMPT_TEMPLATE = (topic: string) => `Analyze the topic: "${topic}"

Provide a comprehensive, fact-rich analysis of this topic. Include key facts, current context, major entities involved, and important developments. Keep the analysis to roughly 1,000-1,500 words, so the response has room for the JSON block that follows it.

After your analysis, output a JSON block (and nothing else after it) in exactly this format:

\`\`\`json
{
  "entities": {
    "people": [{"name": "Person Name", "url": "https://en.wikipedia.org/wiki/Person_Name"}],
    "organizations": [{"name": "Org Name", "url": "https://example.com"}]
  },
  "citations": [
    {"title": "Source Title", "url": "https://example.com/article"}
  ],
  "keyThemes": [
    {"phrase": "carbon tax policy", "relevance": 5},
    {"phrase": "water contamination risks", "relevance": 4}
  ]
}
\`\`\`

For entities, only include proper nouns (specific people and named organizations). Provide Wikipedia or official website URLs where possible. For citations, list 5-10 real sources you would recommend for learning more about this topic. For keyThemes, identify 15-20 key themes as short 2-4 word phrases that capture the most important specific concepts in your analysis. These should be meaningful and specific (e.g. "methane flaring regulations" not "environmental issues"). Score each 1-5 for relevance to the topic.`;

interface ParsedJSON {
  entities?: { people?: unknown; organizations?: unknown };
  citations?: unknown;
  keyThemes?: unknown;
}

// The JSON block below is model-authored, so it drifts from the requested
// schema — a people array of bare strings, `{"theme": ...}` in place of
// `{"phrase": ...}`, a citation with no url. Nothing downstream tolerates that:
// the merge helpers read `.name` / `.phrase` / `.url` straight off each item, so
// one malformed entry threw a TypeError that took down the whole provider's
// result. The sanitizers below coerce what's recoverable, drop what isn't, and
// make the declared return types true.

/** Narrow an unknown value to a plain object, or null if it isn't one. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** First non-empty string among `keys` on a record. */
function pickString(
  record: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function sanitizeEntities(value: unknown): Entity[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Entity[] => {
    // A bare string is a usable name, so keep it rather than dropping the entity.
    if (typeof item === "string") {
      const name = item.trim();
      return name ? [{ name }] : [];
    }
    const record = asRecord(item);
    if (!record) return [];
    const name = pickString(record, ["name", "entity", "title", "person", "organization"]);
    if (!name) return [];
    const url = pickString(record, ["url", "link"]);
    return [url ? { name, url } : { name }];
  });
}

function sanitizeCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Citation[] => {
    // A bare string is a usable URL if it looks like one.
    if (typeof item === "string") {
      const url = item.trim();
      return /^https?:\/\//i.test(url) ? [{ title: url, url }] : [];
    }
    const record = asRecord(item);
    if (!record) return [];
    // A citation with no URL can't be deduplicated or linked — drop it.
    const url = pickString(record, ["url", "link", "source"]);
    if (!url) return [];
    return [{ title: pickString(record, ["title", "name", "source"]) || url, url }];
  });
}

function sanitizeKeyThemes(value: unknown): KeyTheme[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): KeyTheme[] => {
    if (typeof item === "string") {
      const phrase = item.trim();
      return phrase ? [{ phrase, relevance: 3 }] : [];
    }
    const record = asRecord(item);
    if (!record) return [];
    const phrase = pickString(record, ["phrase", "theme", "name", "text"]);
    if (!phrase) return [];
    const raw = record.relevance ?? record.score;
    const relevance = typeof raw === "number" && Number.isFinite(raw) ? raw : 3;
    return [{ phrase, relevance: Math.min(5, Math.max(1, Math.round(relevance))) }];
  });
}

/** Validate and normalize the model's JSON block into the declared shapes. */
function normalizeParsed(parsed: ParsedJSON): {
  entities: ExtractedEntities;
  citations: Citation[];
  keyThemes: KeyTheme[];
} {
  return {
    entities: {
      people: sanitizeEntities(parsed.entities?.people),
      organizations: sanitizeEntities(parsed.entities?.organizations),
    },
    citations: sanitizeCitations(parsed.citations),
    keyThemes: sanitizeKeyThemes(parsed.keyThemes),
  };
}

export function parseStructuredData(
  text: string,
  providerName = "AI"
): {
  entities: ExtractedEntities;
  citations: Citation[];
  keyThemes: KeyTheme[];
} {
  const fallback = {
    entities: {
      people: [],
      organizations: [],
    },
    citations: [],
    keyThemes: [] as KeyTheme[],
  };

  try {
    // Try to extract JSON from code block
    const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      const parsed: ParsedJSON = JSON.parse(codeBlockMatch[1]);
      return normalizeParsed(parsed);
    }

    // Fallback: try to find raw JSON object
    const jsonMatch = text.match(/\{[\s\S]*"entities"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed: ParsedJSON = JSON.parse(jsonMatch[0]);
      return normalizeParsed(parsed);
    }
  } catch (e) {
    console.warn(
      `Failed to parse entities/citations JSON from ${providerName} response:`,
      e
    );
  }

  return fallback;
}

export function extractRawText(text: string): string {
  // Remove the JSON code block from the text to get just the analysis. A
  // response cut off by max_tokens or the timeout leaves the block unclosed, so
  // strip to the end of the text in that case — otherwise its keys and URLs
  // ("entities", "https") end up in the word cloud.
  return text.replace(/```json[\s\S]*?(?:```|$)/, "").trim();
}
