/**
 * Writes a watch item's questions with the model-list "questions" model
 * (getQuestionModel()): the anchor set once, without web search, and a fresh
 * set each snapshot, with web search from the watch item's location so it
 * reflects what's current. Output is a strict JSON schema; every question is
 * then checked by lib/questions/rules.ts and the set gets one retry for
 * whatever it still lacks.
 */
import OpenAI from "openai";
import { computeCost } from "@/lib/answers/prices";
import { getQuestionModel, type ModelChoice } from "@/lib/answers/registry";
import { roundUsd, uniqueQueries } from "@/lib/answers/shared";
import {
  ANCHOR_SIZE,
  FRESH_SIZE,
  LEANS,
  STYLES,
  anchorPlan,
  mixTargets,
  selectQuestions,
  type Candidate,
  type Lean,
  type Rejected,
  type Style,
} from "./rules";

/** Bumped whenever the prompts change, so sets written by different prompts can be told apart. */
export const QUESTIONS_PROMPT_VERSION = "2026-11-09.1";

export type SetKind = "anchor" | "fresh";

export interface WatchItemForQuestions {
  name: string;
  topic: string;
  geography: string | null;
  askCity: string;
  askRegion: string;
  askCountry: string;
  askTimezone: string | null;
}

export interface GenerateOptions {
  item: WatchItemForQuestions;
  subTopics: string[];
  /** Questions still in a locked set, so a fresh set doesn't repeat them. */
  locked?: { text: string; concern: string | null }[];
  /** Concern labels from recent fresh sets, reused when a question is about the same thing. */
  recentConcerns?: string[];
  /** Defaults to ANCHOR_SIZE / FRESH_SIZE. */
  size?: number;
  /** Today, as the model is told it (fresh sets). Defaults to now. */
  today?: Date;
  client?: ResponsesClient;
  settings?: ModelChoice;
  signal?: AbortSignal;
}

export interface GeneratedSet {
  kind: SetKind;
  questions: Candidate[];
  rejected: Rejected[];
  /** What the set still lacked after the retry; empty when it's complete. */
  missing: string[];
  /** Balance or mix problems left after the retry (rules.ts checkSetShape); empty when it's fine. */
  shape: string[];
  model: string;
  modelRegistryId: string | null;
  promptVersion: string;
  costUsd: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  searches: number;
  searchQueries: string[];
  sources: string[];
  priceIds: string[];
}

/** The part of the OpenAI client used here (swappable in tests). */
export type ResponsesClient = Pick<OpenAI, "responses">;

let client: OpenAI | null = null;
function getClient(): OpenAI {
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 4, timeout: 180_000 }));
}

export const QUESTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "subTopic", "concern", "lean", "style", "why"],
        properties: {
          text: { type: "string", description: "Exactly what a real person would type into the chat box." },
          subTopic: { type: ["string", "null"], description: "One of the listed sub-topics, written exactly as listed, or null." },
          concern: { type: "string", description: "2–5 lowercase words naming what the question is really about." },
          lean: { type: "string", enum: ["neutral", "negative", "positive"], description: "Which way it leans toward the industry or topic." },
          style: { type: "string", enum: ["plain", "fragment", "stance"], description: "plain everyday question, short fragment, or one that takes a side." },
          why: { type: ["string", "null"], description: "Fresh sets: the current news that prompted it. Anchor sets: null." },
        },
      },
    },
  },
} as const;

const VOICE_RULES = `How every entry reads: exactly what a real person types into ChatGPT or Gemini, not a pollster's question.
- Often lowercase, short, no question mark; sometimes a fragment ("ercot blackout risk this winter") or a run-on ("my electric bill went up is it the data centers"). Typos are fine but don't overdo them.
- First person and local: "near me", "my bill", "my town", "my kids' school", "here in Albuquerque".
- Use the names people have heard of: ERCOT, fracking, blackouts, the Permian, the grid, the legislature. Spell out true industry jargon in everyday words ("big batteries" or "battery storage" for BESS).
- Stances and worries are fine ("why are data centers bad for texas", "is fracking contaminating water in new mexico"), and so is hope or support ("are wind farms good for rural texas").
- Never name a company, a project developer, a campaign, a trade group or an advocacy group. Places, public agencies, ERCOT, and laws or ballot measures are fine.
- Don't mention AI, chatbots or this study. One question per entry. No two entries ask the same thing.

For each entry, set:
- "style": "plain" (an everyday question), "fragment" (a few typed words, like a search) or "stance" (takes a side).
- "lean": which way it leans toward the industry or topic: "negative" (worried, critical), "positive" (hopeful, supportive) or "neutral". A stance is never neutral.
- Balance: as many positive-leaning as negative-leaning entries in the set, so every worry has a hopeful counterpart on a related point.`;

const CONCERN_RULE = `For each question, "concern" is 2–5 lowercase words naming what it's really about (for example "electric bills", "water supply", "jobs and local taxes", "noise near homes"). Questions about the same underlying thing get the same concern.`;

function place(item: WatchItemForQuestions) {
  return `${item.askCity}, ${item.askRegion}`;
}

function subTopicLines(subTopics: string[]) {
  return subTopics.length ? subTopics.map((s) => `- ${s}`).join("\n") : "(none)";
}

/** The instructions for the anchor set: lasting questions, asked word for word for a year or more. */
export function anchorInstructions(o: GenerateOptions, size: number): string {
  const plan = anchorPlan(o.subTopics, size);
  const mix = mixTargets(size);
  const coverage = o.subTopics.length
    ? `Write ${plan.perSubTopic} about each sub-topic listed (set "subTopic" to it, exactly as listed) and ${plan.overall} about ${o.item.topic.toLowerCase()} overall ("subTopic": null).`
    : `There are no sub-topics: all ${size} are about ${o.item.topic.toLowerCase()} overall ("subTopic": null).`;
  return `You write what ordinary people living in ${place(o.item)} actually type into ChatGPT or Gemini about ${o.item.name.toLowerCase()}. These will be asked word for word every week for a year or more, to see how chatbots' answers change, so they must stay meaningful over that time.

Write ${size} entries. ${coverage}

Mix: about ${mix.plain} plain, ${mix.fragment} fragments and ${mix.stance} stances. Spread the leans so the set is balanced (equal negative and positive).

They are the lasting things people wonder and worry about: bills, jobs and taxes, the grid and blackouts, water, land and property values, noise, health and safety, the environment, who decides and who benefits. For each sub-topic, ask what people living near it actually worry about or hope for, not technical details. Not about one news story, date, bill number or project, so each still makes sense a year from now.

${VOICE_RULES}

${CONCERN_RULE}

Set "why" to null.`;
}

/** The instructions for a fresh set: what's current, found with web search. */
export function freshInstructions(o: GenerateOptions, size: number): string {
  const today = (o.today ?? new Date()).toISOString().slice(0, 10);
  const locked = o.locked?.length ? o.locked.map((q) => `- ${q.text}`).join("\n") : "(none)";
  const concerns = o.recentConcerns?.length ? o.recentConcerns.map((c) => `- ${c}`).join("\n") : "(none yet)";
  return `Today is ${today}. You write what ordinary people living in ${place(o.item)} would type into ChatGPT or Gemini this week about ${o.item.name.toLowerCase()}, because of what's in the news.

First search the web for what people in ${o.item.geography ?? o.item.askRegion} are seeing and hearing about ${o.item.topic.toLowerCase()} right now: the last few weeks' news, local fights, votes, bills, prices, outages, studies, public meetings. Then write ${size} entries people might type because of it, with a mix of plain questions, fragments and stances. Spread them across different stories and angles${o.subTopics.length ? `, and where a question fits one of the sub-topics listed, set "subTopic" to it exactly as listed (otherwise null)` : ` ("subTopic": null)`}.

These can be about current events, but describe a project by what and where it is ("that big data center near abilene"), never by the company behind it.

Don't repeat the questions already asked every week (the locked set below); ask about what's new or newly in the news.

${VOICE_RULES}

${CONCERN_RULE} If a question is about the same thing as one of the recent concern labels below, reuse that label exactly; otherwise write a new one.

Set "why" to one short line on the news that prompted the question.

Sub-topics:
${subTopicLines(o.subTopics)}

Asked every week already (locked set):
${locked}

Recent concern labels:
${concerns}`;
}

type Attempt = ReturnType<typeof selectQuestions>;

function userMessage(kind: SetKind, o: GenerateOptions, size: number, retry?: Attempt) {
  const lines = [
    `<watch_item>${o.item.name}</watch_item>`,
    `<asked_from>${place(o.item)}</asked_from>`,
    `<sub_topics>\n${subTopicLines(o.subTopics)}\n</sub_topics>`,
  ];
  if (!retry) {
    lines.push(`Write the ${kind === "anchor" ? "anchor" : "fresh"} set: ${size} entries.`);
    return lines.join("\n\n");
  }
  const tag = (q: Candidate) => `[${q.subTopic ?? "overall"}; ${q.style}; ${q.lean}]`;
  lines.push(
    `Your last set:\n${retry.kept.map((q) => `- ${q.text} ${tag(q)}`).join("\n") || "(none)"}`,
    `Rejected:\n${retry.rejected.map((q) => `- ${q.text} (${q.issues.join("; ")})`).join("\n") || "(none)"}`,
    `Problems to fix: ${[...retry.missing, ...retry.shape].join("; ")}.`,
    `Write the whole set of ${size} again with these fixed. Keep the entries that were fine, word for word; change or replace only what's needed.`
  );
  return lines.join("\n\n");
}

/** Fewer problems is better; ties go to the earlier attempt. */
function problems(a: Attempt): number {
  return a.missing.length + a.shape.length;
}

async function call(kind: SetKind, o: GenerateOptions, settings: ModelChoice, instructions: string, input: string) {
  const location = { type: "approximate" as const, city: o.item.askCity, region: o.item.askRegion, country: o.item.askCountry, timezone: o.item.askTimezone };
  const response = await (o.client ?? getClient()).responses.create(
    {
      model: settings.model,
      instructions,
      input,
      ...(settings.effortLevel ? { reasoning: { effort: settings.effortLevel as OpenAI.ReasoningEffort } } : {}),
      ...(kind === "fresh"
        ? { tools: [{ type: "web_search" as const, user_location: location }], include: ["web_search_call.action.sources" as const] }
        : {}),
      max_output_tokens: 8000,
      text: {
        format: { type: "json_schema", name: "question_set", strict: true, schema: QUESTIONS_JSON_SCHEMA as unknown as Record<string, unknown> },
      },
      store: false,
    },
    { signal: o.signal }
  );
  if (response.status === "incomplete") {
    throw new Error(`Question set incomplete: ${response.incomplete_details?.reason ?? "unknown reason"}`);
  }

  let searches = 0;
  const queries: string[] = [];
  const sources: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== "web_search_call" || item.action?.type !== "search") continue;
    searches++;
    queries.push(...(item.action.queries ?? []), item.action.query ?? "");
    for (const s of item.action.sources ?? []) if ("url" in s && s.url) sources.push(s.url);
  }
  const u = response.usage;
  const inputTokens = u?.input_tokens ?? 0;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  const outputTokens = u?.output_tokens ?? 0;
  const cost = computeCost(settings.provider, settings.model, { input: inputTokens - cached, cachedInput: cached, output: outputTokens, searches });
  const parsed = JSON.parse(response.output_text) as { questions?: unknown };
  return {
    model: response.model || settings.model,
    candidates: parseCandidates(parsed.questions),
    usd: cost.usd,
    priceIds: cost.priceIds,
    inputTokens,
    outputTokens,
    searches,
    queries,
    sources,
  };
}

/** A "why" line without the markdown source links web search leaves in it. */
export function cleanWhy(why: string): string {
  return why
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

/** The model's questions as candidates; malformed entries are dropped. */
export function parseCandidates(raw: unknown): Candidate[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q): Candidate[] => {
    if (!q || typeof q !== "object") return [];
    const r = q as Record<string, unknown>;
    if (typeof r.text !== "string" || typeof r.concern !== "string") return [];
    const lean = LEANS.includes(r.lean as Lean) ? (r.lean as Lean) : "neutral";
    const style = STYLES.includes(r.style as Style) ? (r.style as Style) : "plain";
    return [
      {
        text: r.text,
        lean,
        style,
        subTopic: typeof r.subTopic === "string" && r.subTopic.trim() ? r.subTopic.trim() : null,
        concern: r.concern,
        why: typeof r.why === "string" && cleanWhy(r.why) ? cleanWhy(r.why) : null,
      },
    ];
  });
}

/** Map a model's sub-topic to the stored name (case and spacing ignored); unknown → null. */
function matchSubTopics(candidates: Candidate[], subTopics: string[]): Candidate[] {
  const byKey = new Map(subTopics.map((s) => [s.toLowerCase().trim(), s]));
  return candidates.map((c) => ({ ...c, subTopic: c.subTopic ? (byKey.get(c.subTopic.toLowerCase().trim()) ?? null) : null }));
}

/**
 * Write one set: call the model, keep what passes the rules, and if anything
 * is missing (a sub-topic short, too few questions) or the shape is off
 * (unbalanced leans, the anchor mix), ask once for the whole set again with
 * the problems listed. The attempt with fewer problems is kept.
 */
export async function generateSet(kind: SetKind, o: GenerateOptions): Promise<GeneratedSet> {
  const settings = o.settings ?? (await getQuestionModel());
  const size = o.size ?? (kind === "anchor" ? ANCHOR_SIZE : FRESH_SIZE);
  const plan = kind === "anchor" ? anchorPlan(o.subTopics, size) : { perSubTopic: 0, overall: 0 };
  const instructions = kind === "anchor" ? anchorInstructions(o, size) : freshInstructions(o, size);
  const existing = (o.locked ?? []).map((q) => q.text);
  const select = (cands: Candidate[]) =>
    selectQuestions(matchSubTopics(cands, o.subTopics), { size, subTopics: o.subTopics, ...plan, existing, mix: kind === "anchor" });

  const totals = { usd: 0, calls: 0, inputTokens: 0, outputTokens: 0, searches: 0, queries: [] as string[], sources: [] as string[], priceIds: new Set<string>() };
  let model = settings.model;
  const add = (r: Awaited<ReturnType<typeof call>>) => {
    model = r.model;
    totals.usd += r.usd;
    totals.calls++;
    totals.inputTokens += r.inputTokens;
    totals.outputTokens += r.outputTokens;
    totals.searches += r.searches;
    totals.queries.push(...r.queries);
    totals.sources.push(...r.sources);
    r.priceIds.forEach((id) => totals.priceIds.add(id));
  };

  const first = await call(kind, o, settings, instructions, userMessage(kind, o, size));
  add(first);
  let result = select(first.candidates);
  if (problems(result) > 0) {
    const retry = await call(kind, o, settings, instructions, userMessage(kind, o, size, result));
    add(retry);
    const second = select(retry.candidates);
    if (problems(second) < problems(result)) result = second;
  }

  return {
    kind,
    questions: result.kept,
    rejected: result.rejected,
    missing: result.missing,
    shape: result.shape,
    model,
    modelRegistryId: settings.registryId,
    promptVersion: QUESTIONS_PROMPT_VERSION,
    costUsd: roundUsd(totals.usd),
    calls: totals.calls,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    searches: totals.searches,
    searchQueries: uniqueQueries(totals.queries),
    sources: [...new Set(totals.sources)],
    priceIds: [...totals.priceIds],
  };
}
