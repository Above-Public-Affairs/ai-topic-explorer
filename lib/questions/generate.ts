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
  anchorPlan,
  selectQuestions,
  type Candidate,
  type Rejected,
} from "./rules";

/** Bumped whenever the prompts change, so sets written by different prompts can be told apart. */
export const QUESTIONS_PROMPT_VERSION = "2026-11-07.1";

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
        required: ["text", "subTopic", "concern", "why"],
        properties: {
          text: { type: "string", description: "The question, word for word as a voter would type it." },
          subTopic: { type: ["string", "null"], description: "One of the listed sub-topics, written exactly as listed, or null." },
          concern: { type: "string", description: "2–5 lowercase words naming what the question is really about." },
          why: { type: ["string", "null"], description: "Fresh sets: the current news that prompted it. Anchor sets: null." },
        },
      },
    },
  },
} as const;

const VOICE_RULES = `How every question reads:
- The way an ordinary voter types into a chatbot: plain, everyday words; first person or everyday phrasing ("Will this raise my electric bill?", "Is it true that…", "Should Texas…"). One question, one sentence, ending in a question mark, under 25 words.
- No jargon or policy and industry terms most voters wouldn't use. Spell acronyms out in everyday words (say "big batteries" or "battery storage", not "BESS"; "the state grid", not "the ISO").
- Fair and neutral: no loaded or emotional words, no assumed answer, nothing that leads. Across the set, mix worried, curious and supportive angles, but each question on its own reads fair to people on either side.
- Never name a company, a project developer, a campaign, a trade group or an advocacy group. Places, public agencies, the grid operator, and laws or ballot measures are fine when a voter would name them.
- Don't mention AI, chatbots or this study.
- No two questions ask the same thing.`;

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
  const coverage = o.subTopics.length
    ? `Write ${plan.perSubTopic} about each sub-topic listed (set "subTopic" to it, exactly as listed) and ${plan.overall} about ${o.item.topic.toLowerCase()} overall ("subTopic": null).`
    : `There are no sub-topics: all ${size} are about ${o.item.topic.toLowerCase()} overall ("subTopic": null).`;
  return `You write the questions an ordinary voter living in ${place(o.item)} might ask an AI chatbot about ${o.item.name.toLowerCase()}. They will be asked word for word every week for a year or more, to see how chatbots' answers change, so they must stay meaningful over that time.

Write ${size} questions. ${coverage}

They are the lasting questions people have: costs and bills, jobs and taxes, the grid and reliability, water, land, health and safety, the environment, who decides and who benefits. Not about one news story, date, bill number or project, so each still makes sense a year from now.

${VOICE_RULES}

${CONCERN_RULE}

Set "why" to null.`;
}

/** The instructions for a fresh set: what's current, found with web search. */
export function freshInstructions(o: GenerateOptions, size: number): string {
  const today = (o.today ?? new Date()).toISOString().slice(0, 10);
  const locked = o.locked?.length ? o.locked.map((q) => `- ${q.text}`).join("\n") : "(none)";
  const concerns = o.recentConcerns?.length ? o.recentConcerns.map((c) => `- ${c}`).join("\n") : "(none yet)";
  return `Today is ${today}. You write the questions an ordinary voter living in ${place(o.item)} might ask an AI chatbot this week about ${o.item.name.toLowerCase()}, because of what's in the news.

First search the web for what people in ${o.item.geography ?? o.item.askRegion} are seeing and hearing about ${o.item.topic.toLowerCase()} right now: the last few weeks' news, local fights, votes, bills, prices, outages, studies, public meetings. Then write ${size} questions a voter might ask because of it. Spread them across different stories and angles${o.subTopics.length ? `, and where a question fits one of the sub-topics listed, set "subTopic" to it exactly as listed (otherwise null)` : ` ("subTopic": null)`}.

These can be about current events, but describe a project by what and where it is ("the big data center planned near Abilene"), never by the company behind it.

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

function userMessage(kind: SetKind, o: GenerateOptions, size: number, retry?: { missing: string[]; rejected: Rejected[]; kept: Candidate[] }) {
  const lines = [
    `<watch_item>${o.item.name}</watch_item>`,
    `<asked_from>${place(o.item)}</asked_from>`,
    `<sub_topics>\n${subTopicLines(o.subTopics)}\n</sub_topics>`,
  ];
  if (!retry) {
    lines.push(`Write the ${kind === "anchor" ? "anchor" : "fresh"} set: ${size} questions.`);
    return lines.join("\n\n");
  }
  lines.push(
    `You already wrote these, which are kept:\n${retry.kept.map((q) => `- ${q.text}`).join("\n") || "(none)"}`,
    `These were rejected:\n${retry.rejected.map((q) => `- ${q.text} (${q.issues.join("; ")})`).join("\n") || "(none)"}`,
    `Write replacements only: ${retry.missing.join(", ")}. Follow the rules above; don't repeat any question listed here.`
  );
  return lines.join("\n\n");
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

/** The model's questions as candidates; malformed entries are dropped. */
export function parseCandidates(raw: unknown): Candidate[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q): Candidate[] => {
    if (!q || typeof q !== "object") return [];
    const r = q as Record<string, unknown>;
    if (typeof r.text !== "string" || typeof r.concern !== "string") return [];
    return [
      {
        text: r.text,
        subTopic: typeof r.subTopic === "string" && r.subTopic.trim() ? r.subTopic.trim() : null,
        concern: r.concern,
        why: typeof r.why === "string" && r.why.trim() ? r.why.trim() : null,
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
 * Write one set: call the model, keep what passes the rules, and retry once
 * for whatever's missing (a sub-topic short, or too few questions).
 */
export async function generateSet(kind: SetKind, o: GenerateOptions): Promise<GeneratedSet> {
  const settings = o.settings ?? (await getQuestionModel());
  const size = o.size ?? (kind === "anchor" ? ANCHOR_SIZE : FRESH_SIZE);
  const plan = kind === "anchor" ? anchorPlan(o.subTopics, size) : { perSubTopic: 0, overall: 0 };
  const instructions = kind === "anchor" ? anchorInstructions(o, size) : freshInstructions(o, size);
  const existing = (o.locked ?? []).map((q) => q.text);
  const select = (cands: Candidate[]) =>
    selectQuestions(matchSubTopics(cands, o.subTopics), { size, subTopics: o.subTopics, ...plan, existing });

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
  let all = first.candidates;
  let result = select(all);
  if (result.missing.length) {
    const retry = await call(kind, o, settings, instructions, userMessage(kind, o, size, result));
    add(retry);
    all = [...all, ...retry.candidates];
    result = select(all);
  }

  return {
    kind,
    questions: result.kept,
    rejected: result.rejected,
    missing: result.missing,
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
