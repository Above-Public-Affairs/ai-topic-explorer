/**
 * The model list: which model each provider is asked with, at what effort,
 * with which search tool, and how the user's location reaches it.
 *
 * The rule: each provider's default for a free, non-paying consumer account,
 * never the flagship tier, so the tracker sees what an ordinary user sees.
 * Each choice is confirmed from the provider's own help pages; where none
 * says (xAI), it's a best guess and marked as one.
 *
 * The live list is the ModelRegistry table (one current row per provider,
 * `retiredAt` null). FREE_TIER_DEFAULTS below seeds it
 * (scripts/seed-model-registry.ts) and stands in when the database can't be
 * read, so a question is never blocked on the registry. The daily model
 * watcher (task 4.5) updates the table: it retires the current row and adds
 * a new one, so past answers keep pointing at the row they were asked with.
 */
import type { LocationMode, ProviderId } from "./types";

/** What a row is for: one of the four answering AIs, the extraction pass, or writing question sets. */
export type ModelRole = "answer" | "extraction" | "questions";

export interface ModelSettings {
  /** Defaults to "answer". */
  role?: ModelRole;
  provider: ProviderId;
  /** API model id sent in the request. */
  model: string;
  /**
   * Effort/reasoning level, in the provider's own terms: OpenAI
   * `reasoning.effort`, Claude `output_config.effort`, Gemini `thinkingLevel`
   * (lowercase), xAI `reasoning.effort`. Null sends none.
   */
  effortLevel: string | null;
  /** The search tool used, e.g. "web_search_20250305". */
  searchSetting: string | null;
  /** How the user location is sent when there is one. */
  locationMode: LocationMode;
  /** When the free-tier default was last confirmed. */
  confirmedAt: Date;
  /** true when no official page says what free users get, so it's a best guess. */
  isGuess: boolean;
  sourceUrl: string | null;
  note: string | null;
}

export interface ModelChoice extends ModelSettings {
  /** The ModelRegistry row this came from; null when it's the built-in fallback. */
  registryId: string | null;
  source: "registry" | "fallback";
}

export const PROVIDER_IDS: ProviderId[] = ["claude", "openai", "gemini", "grok"];

/** Confirmed Nov 7, 2026. Seeds the table and is the fallback when it can't be read. */
export const FREE_TIER_DEFAULTS: Record<ProviderId, ModelSettings> = {
  claude: {
    provider: "claude",
    model: "claude-sonnet-5-5",
    effortLevel: "medium",
    searchSetting: "web_search_20250305",
    locationMode: "parameter",
    confirmedAt: new Date("2026-11-07T00:00:00Z"),
    isGuess: false,
    sourceUrl: "https://claude.com/pricing",
    note:
      "Pricing page: Free includes Sonnet and Haiku, not Opus or Fable. Sonnet is the claude.ai default; Sonnet 5.5 is the current Sonnet. " +
      "Medium effort is the apps' default (anthropic.com/claude-sonnet-5-5). Thinking stays off (between_tools), as decided in task 2.1. " +
      "Basic web_search_20250305, because the newer tool cites nothing.",
  },
  openai: {
    provider: "openai",
    model: "gpt-6-luna",
    effortLevel: "none",
    searchSetting: "web_search",
    locationMode: "parameter",
    confirmedAt: new Date("2026-11-07T00:00:00Z"),
    isGuess: false,
    sourceUrl: "https://help.openai.com/en/articles/6825453-chatgpt-release-notes",
    note:
      "Release notes, Oct 7, 2026: 'Free and Go use GPT-6 Luna' in the Chat tab, from Oct 8. The Free tier FAQ (help.openai.com/en/articles/9275245) " +
      "still says GPT-5.6 Luna and is out of date. Free answers at Instant unless the user picks Think, so reasoning effort is none.",
  },
  gemini: {
    provider: "gemini",
    model: "gemini-3.5-flash-lite",
    effortLevel: "low",
    searchSetting: "google_search",
    locationMode: "by_prompt",
    confirmedAt: new Date("2026-11-07T00:00:00Z"),
    isGuess: false,
    sourceUrl: "https://support.google.com/gemini/answer/18648722",
    note:
      "About Gemini models: without a Google AI plan, chats use 'Auto or Flash-Lite'; with Auto on, most prompts use Flash-Lite (some go to Flash or Pro), " +
      "so Flash-Lite is the default. Since Oct 9, 2026; before then free users got Flash. The page names no version: gemini-3.5-flash-lite is the newest " +
      "Flash-Lite in the API (gemini-flash-lite-latest resolves to it). Thinking level defaults to Low. Google Search grounding takes no location.",
  },
  grok: {
    provider: "grok",
    model: "grok-4.3",
    effortLevel: "low",
    searchSetting: "web_search",
    locationMode: "by_prompt",
    confirmedAt: new Date("2026-11-07T00:00:00Z"),
    isGuess: true,
    sourceUrl: "https://docs.x.ai/developers/models",
    note:
      "Guess: xAI doesn't say which model grok.com's free 'Fast' mode runs. grok-4.3 is its non-flagship model; the flagship grok-4.7 runs paid Expert mode. " +
      "Low is grok-4.3's default reasoning effort. Web search only, no X Search (task 3.2). xAI's search tools take no location, so it goes in the prompt.",
  },
};

/**
 * The extraction model (task 2.7): not one of the answering AIs, so it's a
 * separate kind of row (role "extraction") that getModels() never returns.
 * Seeds the row (migration 20261107200000) and is the fallback when the
 * table can't be read. Confirmed Nov 7, 2026.
 */
export const EXTRACTION_DEFAULT: ModelSettings = {
  role: "extraction",
  provider: "openai",
  model: "gpt-6-luna",
  effortLevel: "none",
  searchSetting: null,
  locationMode: "none",
  confirmedAt: new Date("2026-11-07T00:00:00Z"),
  isGuess: false,
  sourceUrl: "https://developers.openai.com/api/docs/pricing",
  note:
    "Not an answering AI: the one extraction pass over every answer (strict JSON schema, no web search, no location). " +
    "Chosen in task 2.3 as the cheapest model that holds the schema: $0.10 in / $0.50 out per 1M tokens, about $0.0007 per answer. Reasoning effort none.",
};

/**
 * The model that writes each watch item's question sets (task 4.2): the
 * locked anchor set once, and a fresh set with web search every snapshot.
 * Like extraction, it's its own role, never one of the answering AIs. Seeds
 * the row (migration 20261107230100) and is the fallback when the table
 * can't be read. Confirmed Nov 7, 2026.
 */
export const QUESTIONS_DEFAULT: ModelSettings = {
  role: "questions",
  provider: "openai",
  model: "gpt-6-luna",
  effortLevel: "low",
  searchSetting: "web_search",
  locationMode: "parameter",
  confirmedAt: new Date("2026-11-07T00:00:00Z"),
  isGuess: false,
  sourceUrl: "https://developers.openai.com/api/docs/pricing",
  note:
    "Not an answering AI: writes the watch items' question sets. The cheapest model on the list that holds a strict JSON schema and searches the web " +
    "($0.10 in / $0.50 out per 1M tokens, $0.01 a search). Low reasoning effort for steadier wording. Web search (with the watch item's location) only for fresh sets.",
};

/** A ModelRegistry row, as far as the lookup needs it. */
export interface RegistryRow {
  id: string;
  /** Missing is read as "answer". */
  role?: ModelRole;
  provider: ProviderId;
  model: string;
  effortLevel: string | null;
  searchSetting: string | null;
  locationMode: LocationMode;
  confirmedAt: Date;
  isGuess: boolean;
  sourceUrl: string | null;
  note: string | null;
}

/** Reads the current rows (retiredAt null). Swappable for tests. */
export type RegistryLoader = () => Promise<RegistryRow[]>;

async function loadFromDatabase(): Promise<RegistryRow[]> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const { prisma } = await import("@/lib/db");
  // Every current row, answering and extraction alike; load() splits them.
  return prisma.modelRegistry.findMany({
    where: { retiredAt: null },
    // Newest first, so if two current rows ever exist for a provider the
    // latest wins.
    orderBy: { activeFrom: "desc" },
  });
}

let loader: RegistryLoader = loadFromDatabase;

/** Rows are re-read at most this often, so a watcher's update lands within minutes. */
export const CACHE_MS = 5 * 60 * 1000;
interface Loaded {
  choices: Record<ProviderId, ModelChoice>;
  extraction: ModelChoice;
  questions: ModelChoice;
}
let cache: { at: number; loaded: Loaded } | null = null;
let inflight: Promise<Loaded> | null = null;

function fallback(provider: ProviderId): ModelChoice {
  return { ...FREE_TIER_DEFAULTS[provider], registryId: null, source: "fallback" };
}

function fromRow(row: RegistryRow): ModelChoice {
  return {
    role: row.role ?? "answer",
    provider: row.provider,
    model: row.model,
    effortLevel: row.effortLevel,
    searchSetting: row.searchSetting,
    locationMode: row.locationMode,
    confirmedAt: row.confirmedAt,
    isGuess: row.isGuess,
    sourceUrl: row.sourceUrl,
    note: row.note,
    registryId: row.id,
    source: "registry",
  };
}

async function load(): Promise<{ loaded: Loaded; read: boolean }> {
  let rows: RegistryRow[] = [];
  let read = false;
  try {
    rows = await loader();
    read = true;
  } catch (err) {
    console.warn(
      `[Model registry] Couldn't read ModelRegistry; using built-in defaults. ${err instanceof Error ? err.message : err}`
    );
  }
  const answering = rows.filter((r) => (r.role ?? "answer") === "answer");
  const choices = {} as Record<ProviderId, ModelChoice>;
  for (const provider of PROVIDER_IDS) {
    const row = answering.find((r) => r.provider === provider);
    choices[provider] = row ? fromRow(row) : fallback(provider);
  }
  const forRole = (role: ModelRole, fallbackSettings: ModelSettings): ModelChoice => {
    const r = rows.find((x) => x.role === role);
    return r ? fromRow(r) : { ...fallbackSettings, registryId: null, source: "fallback" };
  };
  const extraction = forRole("extraction", EXTRACTION_DEFAULT);
  const questions = forRole("questions", QUESTIONS_DEFAULT);
  return { loaded: { choices, extraction, questions }, read };
}

function loadCached(): Promise<Loaded> {
  if (cache && Date.now() - cache.at < CACHE_MS) return Promise.resolve(cache.loaded);
  inflight ??= load()
    .then(({ loaded, read }) => {
      if (read) cache = { at: Date.now(), loaded };
      return loaded;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Every provider's current model. A provider with no current row (or a
 * database that can't be read) gets its FREE_TIER_DEFAULTS entry, marked
 * `source: "fallback"`. A failed read isn't cached, so the next call retries.
 */
export async function getModels(): Promise<Record<ProviderId, ModelChoice>> {
  return (await loadCached()).choices;
}

/**
 * The extraction model: the current role "extraction" row, or
 * EXTRACTION_DEFAULT (`source: "fallback"`) when there's none or the table
 * can't be read. Read by lib/extraction for every extraction.
 */
export async function getExtractionModel(): Promise<ModelChoice> {
  return (await loadCached()).extraction;
}

/**
 * The model that writes question sets: the current role "questions" row, or
 * QUESTIONS_DEFAULT (`source: "fallback"`). Read by lib/questions.
 */
export async function getQuestionModel(): Promise<ModelChoice> {
  return (await loadCached()).questions;
}

/** One provider's current model. */
export async function getModel(provider: ProviderId): Promise<ModelChoice> {
  return (await getModels())[provider];
}

/** Forget cached rows, so the next lookup reads the table again. */
export function clearModelCache(): void {
  cache = null;
}

/** Replace how rows are read (tests). Pass nothing to restore the database loader. */
export function setRegistryLoader(next?: RegistryLoader): void {
  loader = next ?? loadFromDatabase;
  cache = null;
}

/** Fields that make a row a different model choice; a change to any retires the old row. */
const CHOICE_FIELDS = ["model", "effortLevel", "searchSetting", "locationMode"] as const;

/**
 * Make `settings` the current row for its role and provider. Same model, effort, search
 * and location mode as the current row: that row's confirmation (date,
 * source, note, guess flag) is refreshed. Anything else: the current row is
 * retired and a new one added, so past answers keep their row. For the seed
 * script and the model watcher (task 4.5).
 */
export async function saveModel(
  settings: ModelSettings
): Promise<{ action: "confirmed" | "replaced" | "created"; id: string; retiredId?: string }> {
  const { prisma } = await import("@/lib/db");
  const confirmation = {
    confirmedAt: settings.confirmedAt,
    isGuess: settings.isGuess,
    sourceUrl: settings.sourceUrl,
    note: settings.note,
  };
  const role = settings.role ?? "answer";
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.modelRegistry.findFirst({
      where: { role, provider: settings.provider, retiredAt: null },
      orderBy: { activeFrom: "desc" },
    });
    if (current && CHOICE_FIELDS.every((f) => current[f] === settings[f])) {
      await tx.modelRegistry.update({ where: { id: current.id }, data: confirmation });
      return { action: "confirmed" as const, id: current.id };
    }
    const now = new Date();
    if (current) {
      await tx.modelRegistry.updateMany({
        where: { role, provider: settings.provider, retiredAt: null },
        data: { retiredAt: now },
      });
    }
    const created = await tx.modelRegistry.create({
      data: {
        role,
        provider: settings.provider,
        model: settings.model,
        effortLevel: settings.effortLevel,
        searchSetting: settings.searchSetting,
        locationMode: settings.locationMode,
        activeFrom: now,
        ...confirmation,
      },
    });
    return current
      ? { action: "replaced" as const, id: created.id, retiredId: current.id }
      : { action: "created" as const, id: created.id };
  });
  clearModelCache();
  return result;
}
