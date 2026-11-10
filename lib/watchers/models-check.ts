/**
 * The model watcher's daily check (task 4.5, PROJECT-PLAN §2C, §4D): what
 * model does a free, non-paying consumer account of each provider get by
 * default? Asked of the model list's cheap "questions" model with web search
 * limited to the provider's own domains, then held to clear evidence in code:
 *
 * - The page cited must be on the provider's official domains, and fetching
 *   it must turn up the quoted words, so a misread or invented page can't
 *   change the list.
 * - The new API model id must exist (the provider's models endpoint says so)
 *   and must not be a flagship tier.
 * - Anything short of that is "unclear": the list is left alone and Josh is
 *   told to look by hand.
 *
 * xAI publishes nothing about grok.com's free mode, so Grok stays a guess
 * unless an official page names its free default.
 */
import OpenAI from "openai";
import { computeCost, priceFor } from "@/lib/answers/prices";
import { getQuestionModel, type ModelChoice } from "@/lib/answers/registry";
import type { ProviderId } from "@/lib/answers/types";

export const PROVIDER_NAMES: Record<ProviderId, string> = {
  claude: "Anthropic Claude (claude.ai)",
  openai: "OpenAI ChatGPT (chatgpt.com)",
  gemini: "Google Gemini (the Gemini app, gemini.google.com)",
  grok: "xAI Grok (grok.com)",
};

/** Official domains per provider. Search is limited to them, and the evidence must be on one. */
export const OFFICIAL_DOMAINS: Record<ProviderId, string[]> = {
  claude: ["claude.com", "claude.ai", "anthropic.com"],
  openai: ["openai.com", "chatgpt.com"],
  gemini: ["support.google.com", "gemini.google", "gemini.google.com", "blog.google", "ai.google.dev", "deepmind.google"],
  grok: ["x.ai", "grok.com"],
};

/**
 * Paid-only flagship tiers, never the free default (§2C). A reported model
 * matching one is refused, whatever the page seemed to say.
 */
export const FLAGSHIP_PATTERNS: Record<ProviderId, RegExp[]> = {
  claude: [/opus/i, /fable/i],
  openai: [/-pro\b/i, /\bpro$/i],
  gemini: [/-pro\b/i, /ultra/i, /deep-?think/i],
  grok: [/heavy/i, /^grok-4\.7/i],
};

/** What the check model reports, parsed from its strict JSON output. */
export interface DefaultReport {
  /** true when the official pages still say the current model (or name nothing newer). */
  sameAsCurrent: boolean;
  /** The free default as the consumer app names it ("Sonnet 5.5", "Flash-Lite"). */
  consumerName: string;
  /** The API model id that consumer model maps to. */
  apiModelId: string;
  /** true when no official page ties the consumer name to that API id, so the mapping is a best guess. */
  mappingIsGuess: boolean;
  /** The official page naming the free default. */
  evidenceUrl: string;
  /** Words copied exactly from that page that name the free default. */
  evidenceQuote: string;
  /** When the change took effect, YYYY-MM-DD, if the page says. */
  effectiveDate: string;
  notes: string;
}

export interface CheckOutput {
  report: DefaultReport;
  costUsd: number;
  searches: number;
  sources: string[];
  model: string;
}

export const REPORT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sameAsCurrent", "consumerName", "apiModelId", "mappingIsGuess", "evidenceUrl", "evidenceQuote", "effectiveDate", "notes"],
  properties: {
    sameAsCurrent: { type: "boolean", description: "true unless an official page clearly names a different free default than the current one." },
    consumerName: { type: "string", description: "The free default model as the consumer app names it." },
    apiModelId: { type: "string", description: "The developer API model id for that model, e.g. claude-sonnet-5-5." },
    mappingIsGuess: { type: "boolean", description: "true if no official page ties the consumer name to this exact API id." },
    evidenceUrl: { type: "string", description: "The official page that names the free default. Empty if none." },
    evidenceQuote: { type: "string", description: "A short passage copied word for word from that page that names the free default. Empty if none." },
    effectiveDate: { type: "string", description: "YYYY-MM-DD the change took effect, or empty." },
    notes: { type: "string", description: "One or two sentences on what was found." },
  },
} as const;

export type ResponsesClient = Pick<OpenAI, "responses">;
let client: OpenAI | undefined;
function getClient(): OpenAI {
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 3, timeout: 180_000 }));
}

export const CHECK_PROMPT_VERSION = "2026-11-10.2";

export function checkInstructions(provider: ProviderId, current: ModelChoice, today: Date): string {
  return [
    `Today is ${today.toISOString().slice(0, 10)}. You check which AI model a FREE, non-paying consumer account of ${PROVIDER_NAMES[provider]} uses by default: the model that answers when a signed-in free user types a question without picking anything.`,
    "Rules:",
    "- Only the free tier's default. Never a paid plan's model, never the flagship tier, never a model free users must pick by hand or only get a few uses of.",
    "- Only the provider's own official pages count (help center, pricing page, release notes, model docs). Ignore news articles, blogs by others and forums.",
    `- The model list currently says: ${current.model}${current.isGuess ? " (a best guess: no official page names it)" : ""}, last confirmed ${current.confirmedAt.toISOString().slice(0, 10)} from ${current.sourceUrl ?? "no page"}.`,
    current.note ? `- Notes from the last confirmation: ${current.note}` : "",
    "- Search the official pages for the current free default, starting with the page above and the latest release notes.",
    "- Pages about past launches stay online. An announcement or help page older than the last confirmation describes a past default, not a change. Prefer the newest dated release notes. A model older than the current one is almost never the new default.",
    "- Set sameAsCurrent to false ONLY if an official page clearly says free users now get a different default model. Then give that page in evidenceUrl and copy the exact words naming it into evidenceQuote. Anything less certain: sameAsCurrent true.",
    "- apiModelId is the developer API id for that model. If no official page ties the consumer name to an exact API id, give your best match and set mappingIsGuess true.",
    "- When sameAsCurrent is true, repeat the current model in apiModelId and still cite the page that confirms it, if one does.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Ask the check model what the provider's free default is now. */
export async function askFreeTierDefault(
  provider: ProviderId,
  current: ModelChoice,
  options: { client?: ResponsesClient; settings?: ModelChoice; now?: Date; signal?: AbortSignal } = {}
): Promise<CheckOutput> {
  const settings = options.settings ?? (await getQuestionModel());
  const response = await (options.client ?? getClient()).responses.create(
    {
      model: settings.model,
      instructions: checkInstructions(provider, current, options.now ?? new Date()),
      input: `What is the default model for a free ${PROVIDER_NAMES[provider]} account today?`,
      ...(settings.effortLevel ? { reasoning: { effort: settings.effortLevel as OpenAI.ReasoningEffort } } : {}),
      tools: [{ type: "web_search" as const, filters: { allowed_domains: OFFICIAL_DOMAINS[provider] }, user_location: { type: "approximate" as const, country: "US" } }],
      include: ["web_search_call.action.sources" as const],
      max_output_tokens: 6000,
      text: { format: { type: "json_schema", name: "free_tier_default", strict: true, schema: REPORT_JSON_SCHEMA as unknown as Record<string, unknown> } },
      store: false,
    },
    { signal: options.signal }
  );
  if (response.status === "incomplete") throw new Error(`Model check incomplete: ${response.incomplete_details?.reason ?? "unknown reason"}`);
  let searches = 0;
  const sources: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "web_search_call") continue;
    if (item.action?.type === "search") {
      searches++;
      for (const s of item.action.sources ?? []) if ("url" in s && s.url) sources.push(s.url);
    }
  }
  const u = response.usage;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  const cost = computeCost(settings.provider, settings.model, {
    input: (u?.input_tokens ?? 0) - cached,
    cachedInput: cached,
    output: u?.output_tokens ?? 0,
    searches,
  });
  return { report: parseReport(JSON.parse(response.output_text)), costUsd: cost.usd, searches, sources, model: response.model || settings.model };
}

/** The model's report, with anything malformed read as "no change". */
export function parseReport(raw: unknown): DefaultReport {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
  return {
    sameAsCurrent: r.sameAsCurrent !== false,
    consumerName: str("consumerName"),
    apiModelId: str("apiModelId"),
    mappingIsGuess: r.mappingIsGuess !== false,
    evidenceUrl: str("evidenceUrl"),
    evidenceQuote: str("evidenceQuote"),
    effectiveDate: /^\d{4}-\d{2}-\d{2}$/.test(str("effectiveDate")) ? str("effectiveDate") : "",
    notes: str("notes"),
  };
}

export function isOfficialUrl(provider: ProviderId, url: string): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return OFFICIAL_DOMAINS[provider].some((d) => host === d || host.endsWith(`.${d}`));
}

export function isFlagship(provider: ProviderId, modelId: string): boolean {
  return FLAGSHIP_PATTERNS[provider].some((p) => p.test(modelId));
}

/**
 * The version in a model id: "claude-sonnet-5-5" → [5, 5], "gpt-6-luna" → [6],
 * "gemini-3.5-flash-lite" → [3, 5]. Only the first two parts count, so a
 * date suffix doesn't. Null when the id has no number.
 */
export function modelVersion(id: string): number[] | null {
  const m = id.match(/\d+(?:[.-]\d+)?/);
  return m ? m[0].split(/[.-]/).map(Number) : null;
}

/** true when `next` has a lower version than `current`: almost always a stale page about a past default. */
export function isOlderVersion(next: string, current: string): boolean {
  const a = modelVersion(next);
  const b = modelVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 2; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0;
  }
  return false;
}

/** Lowercase words only, so a quote matches the page whatever its markup, quotes or spacing. */
export function normalizeText(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;|[‘’]/g, "'")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

/** Whether the quoted words appear on the page. */
export function quoteOnPage(quote: string, page: string): boolean {
  const q = normalizeText(quote);
  return q.length >= 8 && normalizeText(page).includes(q);
}

/** Fetches a page's text (swappable in tests). */
export type PageFetcher = (url: string, signal?: AbortSignal) => Promise<string>;
export const fetchPage: PageFetcher = async (url, signal) => {
  const res = await fetch(url, {
    redirect: "follow",
    signal: signal ?? AbortSignal.timeout(30_000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; model-check/1.0)", accept: "text/html,*/*" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

/** Whether the provider's API serves this model id (swappable in tests). */
export type ModelExists = (provider: ProviderId, modelId: string) => Promise<boolean>;
export const modelExists: ModelExists = async (provider, modelId) => {
  const id = encodeURIComponent(modelId);
  const req: Record<ProviderId, () => [string, Record<string, string>]> = {
    claude: () => [`https://api.anthropic.com/v1/models/${id}`, { "x-api-key": process.env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" }],
    openai: () => [`https://api.openai.com/v1/models/${id}`, { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` }],
    gemini: () => [`https://generativelanguage.googleapis.com/v1beta/models/${id}`, { "x-goog-api-key": process.env.GOOGLE_AI_API_KEY ?? "" }],
    grok: () => [`https://api.x.ai/v1/models/${id}`, { authorization: `Bearer ${process.env.XAI_API_KEY ?? ""}` }],
  };
  const [url, headers] = req[provider]();
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404 || res.status === 400) return false;
  if (!res.ok) throw new Error(`${provider} models endpoint: HTTP ${res.status}`);
  return true;
};

/** Whether lib/answers/prices.ts can price the model's tokens; answers can't be costed (or capped) without it. */
export type HasPrices = (provider: ProviderId, modelId: string) => boolean;
export const hasPrices: HasPrices = (provider, modelId) => {
  try {
    priceFor(provider, modelId, "input");
    priceFor(provider, modelId, "output");
    return true;
  } catch {
    return false;
  }
};

export type Decision =
  | { verdict: "unchanged"; sourceUrl: string | null }
  | { verdict: "changed"; modelId: string; isGuess: boolean; sourceUrl: string; quote: string; consumerName: string; effectiveDate: string | null }
  | { verdict: "unclear"; reason: string };

/**
 * Turn a report into a decision, holding a change to clear evidence: an
 * official page that really says it, an API id that exists, no flagship.
 */
export async function decide(
  provider: ProviderId,
  current: Pick<ModelChoice, "model" | "sourceUrl">,
  report: DefaultReport,
  deps: { fetchPage?: PageFetcher; modelExists?: ModelExists; hasPrices?: HasPrices; signal?: AbortSignal } = {}
): Promise<Decision> {
  const official = report.evidenceUrl && isOfficialUrl(provider, report.evidenceUrl) ? report.evidenceUrl : null;
  if (report.sameAsCurrent || !report.apiModelId || report.apiModelId === current.model) {
    return { verdict: "unchanged", sourceUrl: official ?? current.sourceUrl };
  }
  const id = report.apiModelId;
  if (!official) return { verdict: "unclear", reason: `reported ${id} but cited no official page (${report.evidenceUrl || "none"})` };
  if (!report.evidenceQuote) return { verdict: "unclear", reason: `reported ${id} but quoted nothing from ${official}` };
  if (isFlagship(provider, id)) return { verdict: "unclear", reason: `reported ${id}, a flagship tier; the free default is never the flagship` };
  if (isOlderVersion(id, current.model)) {
    return { verdict: "unclear", reason: `reported ${id}, an older version than ${current.model}: likely a stale page (${official}, "${report.evidenceQuote.slice(0, 200)}")` };
  }
  let page: string;
  try {
    page = await (deps.fetchPage ?? fetchPage)(official, deps.signal);
  } catch (err) {
    return { verdict: "unclear", reason: `reported ${id}, but ${official} couldn't be fetched to check the quote (${err instanceof Error ? err.message : err})` };
  }
  if (!quoteOnPage(report.evidenceQuote, page)) {
    return { verdict: "unclear", reason: `reported ${id}, but the quote isn't on ${official}: "${report.evidenceQuote.slice(0, 200)}"` };
  }
  let exists: boolean;
  try {
    exists = await (deps.modelExists ?? modelExists)(provider, id);
  } catch (err) {
    return { verdict: "unclear", reason: `reported ${id}, but its API couldn't be asked whether it exists (${err instanceof Error ? err.message : err})` };
  }
  if (!exists) return { verdict: "unclear", reason: `reported ${id}, which the ${provider} API doesn't serve` };
  if (!(deps.hasPrices ?? hasPrices)(provider, id)) {
    return {
      verdict: "unclear",
      reason: `${id} looks like the new free default ("${report.evidenceQuote.slice(0, 200)}", ${official}), but lib/answers/prices.ts has no price for it. Add its prices and the next daily run switches`,
    };
  }
  return {
    verdict: "changed",
    modelId: id,
    isGuess: report.mappingIsGuess,
    sourceUrl: official,
    quote: report.evidenceQuote,
    consumerName: report.consumerName || id,
    effectiveDate: report.effectiveDate || null,
  };
}
