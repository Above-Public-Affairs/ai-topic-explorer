import OpenAI from "openai";
import type { AIResponse, TokenUsage, QuotedPhrase } from "@/lib/types";
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
  return (client ??= new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  }));
}

function GROK_PROMPT_TEMPLATE(topic: string): string {
  return PROMPT_TEMPLATE(topic) + `\n\nIMPORTANT ADDITIONAL INSTRUCTION: Because you have unique insight into X/Twitter conversations, also include a "quotedPhrases" array in your JSON output block. These should be 8 phrases, slogans, or talking points (each roughly 10-20 words) that represent how real users discuss "${topic}" on X. Format: [{"phrase": "example phrase or talking point people express", "frequency": 5}]. The "frequency" is 1-5 (5 = viral/ubiquitous, 1 = notable but niche). Focus on actual social media language — rallying cries, common opinions, recurring arguments, memes — not academic summaries. Each phrase should be a full thought or argument, not just a few words.`;
}

function extractQuotedPhrases(text: string): QuotedPhrase[] {
  try {
    const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      const parsed = JSON.parse(codeBlockMatch[1]);
      if (Array.isArray(parsed.quotedPhrases)) {
        return parsed.quotedPhrases
          .filter(
            (q: unknown): q is { phrase: string; frequency?: number } =>
              typeof q === "object" &&
              q !== null &&
              "phrase" in q &&
              typeof (q as Record<string, unknown>).phrase === "string"
          )
          .slice(0, 8)
          .map((q: { phrase: string; frequency?: number }) => ({
            phrase: q.phrase,
            frequency: Math.min(5, Math.max(1, q.frequency || 3)),
          }));
      }
    }
  } catch {
    console.warn("Failed to parse quotedPhrases from Grok response");
  }
  return [];
}

export async function analyzeWithGrok(
  query: string,
  signal?: AbortSignal
): Promise<AIResponse> {
  const completion = await getClient().chat.completions.create(
    {
      model: "grok-3",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: GROK_PROMPT_TEMPLATE(query),
        },
      ],
    },
    { signal, maxRetries: REQUEST_MAX_RETRIES }
  );

  const responseText = completion.choices[0]?.message?.content || "";

  const usage: TokenUsage = {
    inputTokens: completion.usage?.prompt_tokens || 0,
    outputTokens: completion.usage?.completion_tokens || 0,
    purpose: "analysis",
  };

  console.log(
    `[Analysis: Grok] Query: "${query.slice(0, 60)}..." — Tokens — input: ${usage.inputTokens}, output: ${usage.outputTokens}`
  );

  if (completion.choices[0]?.finish_reason === "length") {
    console.warn("Grok response was truncated due to max_tokens limit");
  }

  const { entities, citations, keyThemes } = parseStructuredData(responseText, "Grok");
  const quotedPhrases = extractQuotedPhrases(responseText);

  return {
    provider: "grok",
    rawText: extractRawText(responseText),
    entities,
    citations,
    keyThemes,
    model: "grok-3",
    usage: [usage],
    ...(quotedPhrases.length > 0 && { quotedPhrases }),
  };
}
