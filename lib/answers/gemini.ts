import { ApiError, GoogleGenAI, type GenerateContentResponse } from "@google/genai";
import { MODEL } from "@/lib/ai-clients/gemini";
import { isGeminiQuotaExhausted } from "./errors";
import { computeCost } from "./prices";
import { locationSystemMessage, mergeSources, roundUsd, uniqueQueries } from "./shared";
import type { AnswerProvider, AnswerSource, AskOptions, AskResult } from "./types";

// Google answers "high demand" (503), rate limits (429) and the odd 500 with
// errors that usually clear within seconds.
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [1_000, 3_000];

let ai: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  return (ai ??= new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY || "" }));
}

async function generate(
  question: string,
  systemInstruction: string | undefined,
  signal?: AbortSignal
): Promise<GenerateContentResponse> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getClient().models.generateContent({
        model: MODEL,
        contents: question,
        config: {
          // Grounding with Google Search takes no location, so it rides in the
          // system instruction ("by prompt").
          ...(systemInstruction && { systemInstruction }),
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingBudget: 0 },
          abortSignal: signal,
        },
      });
    } catch (err) {
      // An exhausted quota won't clear in seconds, so don't retry it.
      const retryable =
        err instanceof ApiError && RETRYABLE_STATUSES.has(err.status) && !isGeminiQuotaExhausted(err);
      if (!retryable || attempt >= RETRY_DELAYS_MS.length || signal?.aborted) throw err;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
}

async function ask(question: string, options: AskOptions = {}): Promise<AskResult> {
  const { location, signal } = options;
  const started = Date.now();

  const response = await generate(
    question,
    location ? locationSystemMessage(location) : undefined,
    signal
  );

  const candidate = response.candidates?.[0];
  const answer = response.text ?? "";
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason || !answer) {
    throw new Error(
      `Gemini returned no text (${blockReason ? `prompt blocked: ${blockReason}` : `finish reason: ${candidate?.finishReason}`})`
    );
  }

  // groundingChunks are the pages the searches returned; groundingSupports
  // tie spans of the answer to chunk indices, so a chunk no support points
  // at was only looked at.
  const grounding = candidate?.groundingMetadata;
  const citedIndices = new Set(
    (grounding?.groundingSupports ?? []).flatMap((s) => s.groundingChunkIndices ?? [])
  );
  const sources: AnswerSource[] = (grounding?.groundingChunks ?? []).flatMap((chunk, i) =>
    chunk.web?.uri
      ? [{ url: chunk.web.uri, title: chunk.web.title ?? null, cited: citedIndices.has(i) }]
      : []
  );
  const queries = uniqueQueries(grounding?.webSearchQueries ?? []);

  const u = response.usageMetadata;
  // Search results come back as toolUsePromptTokenCount and are billed as
  // input; thinking tokens are billed as output.
  const inputTokens = (u?.promptTokenCount ?? 0) + (u?.toolUsePromptTokenCount ?? 0);
  const cachedInput = u?.cachedContentTokenCount ?? 0;
  const reasoningTokens = u?.thoughtsTokenCount ?? 0;
  const outputTokens = (u?.candidatesTokenCount ?? 0) + reasoningTokens;
  // Gemini 3 bills each search query the model runs.
  const searches = queries.length;
  const cost = computeCost("gemini", MODEL, {
    // No cached-input price row: implicit caching rarely applies to a one-shot
    // question, so cached tokens are priced as input (an overstatement).
    input: inputTokens,
    output: outputTokens,
    searches,
  });

  return {
    provider: "gemini",
    requestedModel: MODEL,
    model: response.modelVersion ?? MODEL,
    question,
    answer: answer.trim(),
    sources: mergeSources(sources),
    searchQueries: queries,
    usage: {
      inputTokens,
      cachedInputTokens: cachedInput,
      outputTokens,
      reasoningTokens,
      searchCalls: searches,
    },
    location: location ?? null,
    locationMode: location ? "by_prompt" : "none",
    cost: {
      usd: roundUsd(cost.usd),
      source: "computed",
      breakdown: { tokensUsd: roundUsd(cost.tokensUsd), searchUsd: roundUsd(cost.searchUsd) },
      priceIds: cost.priceIds,
      note:
        "Search priced at list ($14/1k); the first 5,000 searches a month are free, so this overstates cost inside the allowance.",
    },
    finishReason: candidate?.finishReason ?? null,
    latencyMs: Date.now() - started,
  };
}

export const geminiProvider: AnswerProvider = { id: "gemini", model: MODEL, ask };
