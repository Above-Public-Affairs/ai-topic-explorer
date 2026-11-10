/**
 * The event watcher's web searches (task 4.7). Web search only, no other
 * connectors: one call per scope, each a cheap model with a strict JSON schema.
 *
 * Daily scan scopes:
 * - "ai": model_policy and crawler_change (AI companies and publishers), all items;
 * - each tracked geography: election, legislative_session and major_news on its items;
 * - federal: the same three at the federal level, all items.
 *
 * Known dates (weekly): official election days and legislative session start
 * and end dates for each geography and federal, for the next 12 months.
 */
import OpenAI from "openai";
import { computeCost } from "@/lib/answers/prices";
import { roundUsd } from "@/lib/answers/shared";
import { EVENTS_JSON_SCHEMA, FEDERAL, cleanUrl, hostOf, itemsForGeography, parseCandidates, type Candidate, type KnownEvent, type WatchedCategory, type WatchItemRef } from "./rules";

/**
 * The watcher's model: the cheapest on the list that searches the web and
 * holds a strict schema (GPT-6 Luna: $0.10 in / $0.50 out per 1M tokens, $0.01
 * a search), as for the question sets. Kept in code rather than a registry
 * role, since it isn't an answering AI and nothing else reads it.
 */
export const WATCHER_MODEL = { provider: "openai" as const, model: "gpt-6-luna", effort: "low" as const };
/** Searches one call may run; bounds a call's cost (about $0.12 at most in search fees). */
export const MAX_SEARCHES_PER_CALL = 12;
export const PROMPT_VERSION = "2026-11-10.1";

export type ResponsesClient = Pick<OpenAI, "responses">;
let client: OpenAI | null = null;
function getClient(): OpenAI {
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 3, timeout: 180_000 }));
}

export interface Scope {
  /** "ai", a geography, or "federal". */
  name: string;
  kind: "scan" | "known_dates";
  categories: WatchedCategory[];
  geography: string | null;
  items: WatchItemRef[];
}

/** The scopes for a daily scan, from the active watch items. */
export function scanScopes(items: WatchItemRef[], geographies: string[]): Scope[] {
  const scopes: Scope[] = [{ name: "ai", kind: "scan", categories: ["model_policy", "crawler_change"], geography: null, items }];
  for (const g of geographies) {
    scopes.push({ name: g, kind: "scan", categories: ["election", "legislative_session", "major_news"], geography: g, items: itemsForGeography(items, g) });
  }
  return scopes.filter((s) => s.items.length);
}

/** The scopes for the known-dates refresh: elections and sessions, each geography and federal, one call each. */
export function knownDateScopes(items: WatchItemRef[], geographies: string[]): Scope[] {
  return geographies
    .flatMap((g) =>
      (["election", "legislative_session"] as const).map(
        (c): Scope => ({ name: `${g} ${c === "election" ? "elections" : "sessions"}`, kind: "known_dates", categories: [c], geography: g, items: itemsForGeography(items, g) })
      )
    )
    .filter((s) => s.items.length);
}

const BAR = `The bar is "big enough to move what an AI chatbot says" when an ordinary person asks it about the watch item. Most news doesn't clear it. Report an event only if it clears it:
- Counts: a new law, executive order, regulation, ruling or official policy announcement directly on the watch item; a statewide or national decision, vote result, or major official report; a large incident that dominates statewide or national coverage. Data center policy announcements count.
- Doesn't count: hearings of any kind (never), routine groundbreakings, openings and expansions of single projects, company earnings, op-eds, local zoning meetings, proposals that haven't moved, and anything mainly about one company.
When in doubt, leave it out. An empty list is a normal answer.`;

const CATEGORY_TEXT: Record<WatchedCategory, string> = {
  model_policy:
    "model_policy: an AI chatbot company (OpenAI/ChatGPT, Google/Gemini, Anthropic/Claude, xAI/Grok) changes how its chatbot handles political or election topics, or its web search and sourcing rules.",
  crawler_change: "crawler_change: a major news publisher blocks or unblocks AI crawlers, or signs an AI content licensing deal.",
  election: "election: an election day, or certified results of an election, in the geography.",
  legislative_session: "legislative_session: the legislature (or Congress, for federal) starts or ends a regular or special session.",
  major_news: "major_news: statewide or national news directly on one of the watch items.",
};

function itemLines(items: WatchItemRef[]): { text: string; refs: Map<string, string> } {
  const refs = new Map<string, string>();
  const text = items
    .map((it, i) => {
      refs.set(`W${i + 1}`, it.id);
      return `W${i + 1}: ${it.name} (topic: ${it.topic}${it.geography ? `; place: ${it.geography}` : ""}${it.subTopics.length ? `; sub-topics: ${it.subTopics.join(", ")}` : ""})`;
    })
    .join("\n");
  return { text, refs };
}

function eventLines(known: KnownEvent[]): { text: string; refs: Map<string, string> } {
  const refs = new Map<string, string>();
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const e of known) {
    const key = `${e.title}|${e.occurredAt.toISOString().slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const ref = `E${lines.length + 1}`;
    refs.set(ref, e.id);
    lines.push(`${ref}: [${e.category}] ${e.occurredAt.toISOString().slice(0, 10)} ${e.title}${e.sourceUrl ? ` (${hostOf(e.sourceUrl)})` : ""}`);
  }
  return { text: lines.join("\n") || "(none)", refs };
}

export function scanInstructions(scope: Scope, today: Date, since: Date): string {
  const where = scope.name === "ai" ? "AI companies and news publishers" : scope.geography === FEDERAL ? "the federal government (Congress, the White House, federal agencies, federal courts)" : scope.geography!;
  return `Today is ${today.toISOString().slice(0, 10)}. You watch for events that may change what AI chatbots tell people about the watch items below. Search the web for events about ${where} that happened from ${since.toISOString().slice(0, 10)} to today, in these categories only:
${scope.categories.map((c) => `- ${CATEGORY_TEXT[c]}`).join("\n")}

${BAR}

Run separate searches for each watch item and each category above (for example "<topic> <place> news this week", "<place> legislature special session", "<place> election results certified"); a single broad search misses things.

For each event: list the watch items it is directly about (refs W1, W2…); for ${scope.name === "ai" ? "AI company and publisher events, list every watch item and set geography to null" : `this search set geography to "${scope.geography}"`}. Give the date it happened, the best source (the official page if there is one, otherwise the outlet that broke it) and one sentence on why it clears the bar. The same story reported by several outlets is one event. If it is the same story as an already-logged event below, set duplicateOf to that event's ref; otherwise null. Don't report scheduled future dates here.`;
}

export function knownDatesInstructions(scope: Scope, today: Date): string {
  const until = new Date(today.getTime() + 365 * 24 * 3600 * 1000);
  const federal = scope.geography === FEDERAL;
  const range = `from ${today.toISOString().slice(0, 10)} to ${until.toISOString().slice(0, 10)}`;
  const ask =
    scope.categories[0] === "election"
      ? `${
          federal
            ? `every nationwide federal general election day ${range} (the November election for Congress or President). Not primaries, runoffs or special elections held in only some states; if there is no nationwide federal election in that range, return an empty list.`
            : `every statewide ${scope.geography} election day ${range} (primaries, runoffs, general, constitutional amendment and special elections), and the date the results of the most recent statewide election are officially certified or canvassed, if that is still ahead.`
        } Category "election". Run separate searches for upcoming election days and for the canvass or certification date.`
      : `the first and last day of each regular session of ${federal ? "the U.S. Congress (a new Congress convening, and a Congress or session adjourning sine die)" : `the ${scope.geography} Legislature`} ${range}, and any special session already called. Category "legislative_session". Run separate searches for the session's first day and for its last day (sine die, or the end date fixed by the constitution or statute), and enter both.`;
  return `Today is ${today.toISOString().slice(0, 10)}. Find, on official government pages, ${ask}

Use only official sources (Secretary of State, the legislature's or Congress's own site, other .gov or .us pages) for sourceUrl, and the most specific page that states the date. One entry per date. Leave out dates you can't confirm on an official page. Set every entry's watchItems to all refs listed, geography to "${scope.geography}", duplicateOf to the matching ref below if the date is already logged (else null), and whyItClearsTheBar to what the date is.`;
}

export interface ScopeResult {
  scope: string;
  kind: Scope["kind"];
  candidates: Candidate[];
  dropped: { title: string; reason: string }[];
  costUsd: number;
  searches: number;
  queries: string[];
  model: string;
}

/** One web-search call for a scope. */
export async function searchScope(
  scope: Scope,
  options: { today: Date; since?: Date; known: KnownEvent[]; client?: ResponsesClient; signal?: AbortSignal }
): Promise<ScopeResult> {
  const items = itemLines(scope.items);
  const events = eventLines(options.known);
  const instructions = scope.kind === "scan" ? scanInstructions(scope, options.today, options.since ?? options.today) : knownDatesInstructions(scope, options.today);
  const input = `<watch_items>\n${items.text}\n</watch_items>\n\n<already_logged_events>\n${events.text}\n</already_logged_events>`;
  const country = "US";
  const response = await (options.client ?? getClient()).responses.create(
    {
      model: WATCHER_MODEL.model,
      instructions,
      input,
      reasoning: { effort: WATCHER_MODEL.effort },
      tools: [{ type: "web_search", user_location: { type: "approximate", country } }],
      include: ["web_search_call.action.sources"],
      max_tool_calls: MAX_SEARCHES_PER_CALL,
      max_output_tokens: 6000,
      text: { format: { type: "json_schema", name: "events", strict: true, schema: EVENTS_JSON_SCHEMA as unknown as Record<string, unknown> } },
      store: false,
    },
    { signal: options.signal }
  );

  let searches = 0;
  const queries: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "web_search_call" || item.action?.type !== "search") continue;
    searches++;
    if (item.action.query) queries.push(item.action.query);
    queries.push(...(item.action.queries ?? []));
  }
  const u = response.usage;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  const cost = computeCost(WATCHER_MODEL.provider, WATCHER_MODEL.model, { input: (u?.input_tokens ?? 0) - cached, cachedInput: cached, output: u?.output_tokens ?? 0, searches });
  const base = { scope: scope.name, kind: scope.kind, costUsd: roundUsd(cost.usd), searches, queries: [...new Set(queries.filter(Boolean))], model: response.model || WATCHER_MODEL.model };

  if (response.status === "incomplete") {
    return { ...base, candidates: [], dropped: [{ title: "(whole response)", reason: `incomplete: ${response.incomplete_details?.reason ?? "unknown"}` }] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(response.output_text);
  } catch {
    return { ...base, candidates: [], dropped: [{ title: "(whole response)", reason: "not JSON" }] };
  }
  if (scope.kind === "known_dates" && raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events)) {
    // Calendar dates apply to every item in the geography, whatever the model listed.
    for (const e of (raw as { events: Record<string, unknown>[] }).events) if (e && typeof e === "object") e.watchItems = [...items.refs.keys()];
  }
  const parsed = parseCandidates(raw, items.refs, events.refs);
  let candidates = parsed.candidates;
  const dropped = [...parsed.dropped];
  if (scope.kind === "known_dates") {
    candidates = candidates.filter((c) => {
      if (isOfficial(c.sourceUrl)) return true;
      dropped.push({ title: c.title, reason: `not an official source: ${hostOf(c.sourceUrl)}` });
      return false;
    });
  }
  // Keep each event inside this scope's items (a geography call can't move another state's items).
  const allowed = new Set(scope.items.map((i) => i.id));
  candidates = candidates.flatMap((c) => {
    const ids = c.watchItemIds.filter((id) => allowed.has(id));
    return ids.length ? [{ ...c, watchItemIds: ids, geography: scope.geography ?? c.geography }] : [];
  });
  return { ...base, candidates, dropped };
}

/** Official government source: a .gov or .us host. */
export function isOfficial(url: string): boolean {
  const clean = cleanUrl(url);
  if (!clean) return false;
  return /\.(gov|us)$/i.test(new URL(clean).hostname);
}
