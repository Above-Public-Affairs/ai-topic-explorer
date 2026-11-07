import OpenAI from "openai";
import { MODEL } from "@/lib/ai-clients/grok";
import { REQUEST_MAX_RETRIES } from "@/lib/ai-clients/shared";
import { XAI_TICKS_PER_USD } from "./prices";
import { locationSystemMessage, mergeSources, roundUsd, uniqueQueries } from "./shared";
import type { AnswerProvider, AnswerSource, AskOptions, AskResult } from "./types";

// Server-side web search only runs on xAI's Responses API (/v1/responses),
// not Chat Completions. Web search only: no X Search (decided Nov 7, 2026).

let client: OpenAI | null = null;
function getClient(): OpenAI {
  return (client ??= new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  }));
}

/** xAI fields the OpenAI SDK's types don't declare. */
interface XaiResponseExtras {
  /** Every URL the searches touched, cited or not. */
  citations?: unknown;
  usage?: {
    cost_in_usd_ticks?: number;
    num_server_side_tools_used?: number;
    server_side_tool_usage_details?: Record<string, number>;
  } | null;
}

async function ask(question: string, options: AskOptions = {}): Promise<AskResult> {
  const { location, signal } = options;
  const started = Date.now();

  const input: OpenAI.Responses.ResponseInput = [];
  // xAI's search tools take no location, so it goes in a system message.
  if (location) input.push({ role: "system", content: locationSystemMessage(location) });
  input.push({ role: "user", content: question });

  const response = await getClient().responses.create(
    {
      model: MODEL,
      input,
      reasoning: { effort: "low" },
      max_output_tokens: 16000,
      tools: [{ type: "web_search" }],
      store: false,
    },
    { signal, maxRetries: REQUEST_MAX_RETRIES }
  );
  const extras = response as unknown as XaiResponseExtras;

  const sources: AnswerSource[] = [];
  const queries: string[] = [];
  let searches = 0;

  for (const item of response.output) {
    if (item.type === "web_search_call") {
      const action = item.action as
        | { type?: string; query?: string; queries?: string[]; sources?: { url?: string }[] }
        | undefined;
      if (action?.type === "search" || action?.query || action?.queries) {
        searches++;
        queries.push(...(action?.queries ?? []), action?.query ?? "");
      }
      for (const s of action?.sources ?? []) {
        if (s.url) sources.push({ url: s.url, title: null, cited: false });
      }
    } else if (item.type === "message") {
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const a of part.annotations) {
          // xAI's annotation title is the citation label ("1"), not a page title.
          if (a.type === "url_citation") sources.push({ url: a.url, title: null, cited: true });
        }
      }
    }
  }
  if (Array.isArray(extras.citations)) {
    for (const url of extras.citations) {
      if (typeof url === "string") sources.push({ url, title: null, cited: false });
    }
  }

  const ticks = extras.usage?.cost_in_usd_ticks;
  if (typeof ticks !== "number") {
    throw new Error("xAI response had no usage.cost_in_usd_ticks; cost can't be recorded");
  }
  const u = response.usage;

  return {
    provider: "grok",
    requestedModel: MODEL,
    model: response.model,
    question,
    answer: response.output_text.trim(),
    sources: mergeSources(sources),
    searchQueries: uniqueQueries(queries),
    usage: {
      inputTokens: u?.input_tokens ?? 0,
      cachedInputTokens: u?.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: u?.output_tokens ?? 0,
      reasoningTokens: u?.output_tokens_details?.reasoning_tokens ?? 0,
      searchCalls: extras.usage?.server_side_tool_usage_details?.web_search_calls ?? searches,
    },
    location: location ?? null,
    locationMode: location ? "by_prompt" : "none",
    cost: {
      usd: roundUsd(ticks / XAI_TICKS_PER_USD),
      source: "provider",
      priceIds: [],
    },
    finishReason: response.incomplete_details?.reason ?? response.status ?? null,
    latencyMs: Date.now() - started,
  };
}

export const grokProvider: AnswerProvider = { id: "grok", model: MODEL, ask };
