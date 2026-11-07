import OpenAI from "openai";
import type { AIResponse, TokenUsage } from "@/lib/types";
import {
  PROMPT_TEMPLATE,
  parseStructuredData,
  extractRawText,
  REQUEST_MAX_RETRIES,
} from "./shared";

// Built on first use, not at module load, so `next build` (which loads this
// module to collect route config) works without API keys in the environment.
let client: OpenAI | null = null;
function getClient(): OpenAI {
  return (client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY }));
}

export async function analyzeWithOpenAI(
  query: string,
  signal?: AbortSignal
): Promise<AIResponse> {
  const completion = await getClient().chat.completions.create(
    {
      model: "gpt-4o",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: PROMPT_TEMPLATE(query),
        },
      ],
    },
    // Without the signal a timed-out request keeps running to completion on the
    // provider's side, still consuming rate-limit budget for a result nobody
    // reads.
    { signal, maxRetries: REQUEST_MAX_RETRIES }
  );

  const responseText = completion.choices[0]?.message?.content || "";

  const usage: TokenUsage = {
    inputTokens: completion.usage?.prompt_tokens || 0,
    outputTokens: completion.usage?.completion_tokens || 0,
    purpose: "analysis",
  };

  console.log(
    `[Analysis: OpenAI] Query: "${query.slice(0, 60)}..." — Tokens — input: ${usage.inputTokens}, output: ${usage.outputTokens}`
  );

  if (completion.choices[0]?.finish_reason === "length") {
    console.warn("OpenAI response was truncated due to max_tokens limit");
  }

  const { entities, citations, keyThemes } = parseStructuredData(responseText, "OpenAI");

  return {
    provider: "openai",
    rawText: extractRawText(responseText),
    entities,
    citations,
    keyThemes,
    model: "gpt-4o",
    usage: [usage],
  };
}
