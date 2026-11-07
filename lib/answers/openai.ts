import OpenAI from "openai";
import { REQUEST_MAX_RETRIES } from "@/lib/ai-clients/shared";
import { computeCost } from "./prices";
import { getModel } from "./registry";
import { mergeSources, planLocation, roundUsd, uniqueQueries } from "./shared";
import type { AnswerProvider, AnswerSource, AskOptions, AskResult } from "./types";

let client: OpenAI | null = null;
function getClient(): OpenAI {
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

async function ask(question: string, options: AskOptions = {}): Promise<AskResult> {
  const { signal } = options;
  const settings = options.settings ?? (await getModel("openai"));
  const model = settings.model;
  const loc = planLocation(options.location, settings.locationMode, true);
  const location = loc.parameter;
  const started = Date.now();

  const input: OpenAI.Responses.ResponseInput = [];
  if (loc.systemMessage) input.push({ role: "system", content: loc.systemMessage });
  input.push({ role: "user", content: question });

  const response = await getClient().responses.create(
    {
      model,
      input,
      // Free ChatGPT answers at Instant (effort none) unless the user picks Think.
      ...(settings.effortLevel && {
        reasoning: { effort: settings.effortLevel as OpenAI.ReasoningEffort },
      }),
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
  const cost = computeCost("openai", model, {
    input: inputTokens - cachedInput,
    cachedInput,
    output: outputTokens,
    searches,
  });

  return {
    provider: "openai",
    requestedModel: model,
    modelRegistryId: settings.registryId,
    effortLevel: settings.effortLevel,
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
    location: loc.mode === "none" ? null : (options.location ?? null),
    locationMode: loc.mode,
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

export const openaiProvider: AnswerProvider = { id: "openai", ask };
