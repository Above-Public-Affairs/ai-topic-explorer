import OpenAI from "openai";
import { MODEL } from "@/lib/ai-clients/openai";
import { REQUEST_MAX_RETRIES } from "@/lib/ai-clients/shared";
import { computeCost } from "./prices";
import { mergeSources, roundUsd, uniqueQueries } from "./shared";
import type { AnswerProvider, AnswerSource, AskOptions, AskResult } from "./types";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

async function ask(question: string, options: AskOptions = {}): Promise<AskResult> {
  const { location, signal } = options;
  const started = Date.now();

  const response = await getClient().responses.create(
    {
      model: MODEL,
      input: question,
      // Free ChatGPT answers at Instant unless the user picks Think.
      reasoning: { effort: "none" },
      max_output_tokens: 16000,
      tools: [
        {
          type: "web_search",
          // Omitting user_location defaults to the US, so pass {type} alone
          // when there's no location.
          user_location: location
            ? {
                type: "approximate",
                city: location.city,
                region: location.region,
                country: location.country,
                timezone: location.timezone ?? null,
              }
            : { type: "approximate" },
        },
      ],
      // Every URL the searches returned, not only the cited ones.
      include: ["web_search_call.action.sources"],
      store: false,
    },
    { signal, maxRetries: REQUEST_MAX_RETRIES }
  );

  const sources: AnswerSource[] = [];
  const queries: string[] = [];
  let searches = 0;

  for (const item of response.output) {
    if (item.type === "web_search_call") {
      const action = item.action;
      if (action?.type === "search") {
        searches++;
        queries.push(...(action.queries ?? []), action.query ?? "");
        for (const s of action.sources ?? []) {
          if ("url" in s && s.url) sources.push({ url: s.url, title: null, cited: false });
        }
      }
    } else if (item.type === "message") {
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const a of part.annotations) {
          if (a.type === "url_citation") sources.push({ url: a.url, title: a.title || null, cited: true });
        }
      }
    }
  }

  const u = response.usage;
  const inputTokens = u?.input_tokens ?? 0;
  const cachedInput = u?.input_tokens_details?.cached_tokens ?? 0;
  const outputTokens = u?.output_tokens ?? 0;
  const cost = computeCost("openai", MODEL, {
    input: inputTokens - cachedInput,
    cachedInput,
    output: outputTokens,
    searches,
  });

  return {
    provider: "openai",
    requestedModel: MODEL,
    model: response.model,
    question,
    answer: response.output_text.trim(),
    sources: mergeSources(sources),
    searchQueries: uniqueQueries(queries),
    usage: {
      inputTokens,
      cachedInputTokens: cachedInput,
      outputTokens,
      reasoningTokens: u?.output_tokens_details?.reasoning_tokens ?? 0,
      searchCalls: searches,
    },
    location: location ?? null,
    locationMode: location ? "parameter" : "none",
    cost: {
      usd: roundUsd(cost.usd),
      source: "computed",
      breakdown: { tokensUsd: roundUsd(cost.tokensUsd), searchUsd: roundUsd(cost.searchUsd) },
      priceIds: cost.priceIds,
    },
    finishReason: response.incomplete_details?.reason ?? response.status ?? null,
    latencyMs: Date.now() - started,
  };
}

export const openaiProvider: AnswerProvider = { id: "openai", model: MODEL, ask };
