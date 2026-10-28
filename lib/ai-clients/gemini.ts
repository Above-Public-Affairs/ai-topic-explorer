import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import type { AIResponse, TokenUsage } from "@/lib/types";
import { PROMPT_TEMPLATE, parseStructuredData, extractRawText } from "./shared";

// gemini-2.5-flash is closed to new Google projects ("no longer available to new
// users"), which the rotated key's project is. thinkingBudget 0 still turns
// thinking off on the 3.x Flash models.
const MODEL = "gemini-3.5-flash";

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

export async function analyzeWithGemini(
  query: string,
  signal?: AbortSignal
): Promise<AIResponse> {
  const model = genAI.getGenerativeModel({
    model: MODEL,
    safetySettings: [
      { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
      { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
    ],
    generationConfig: {
      thinkingConfig: { thinkingBudget: 0 },
    } as Record<string, unknown>,
  });

  // Pass the signal so a timed-out request is actually cancelled rather than
  // left running in the background.
  const result = await model.generateContent(PROMPT_TEMPLATE(query), { signal });
  const response = result.response;
  const responseText = response.text();

  const usageMetadata = response.usageMetadata;
  const usage: TokenUsage = {
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    purpose: "analysis",
  };

  console.log(
    `[Analysis: Gemini] Query: "${query.slice(0, 60)}..." — Tokens — input: ${usage.inputTokens}, output: ${usage.outputTokens}`
  );

  const { entities, citations, keyThemes } = parseStructuredData(responseText, "Gemini");

  return {
    provider: "gemini",
    rawText: extractRawText(responseText),
    entities,
    citations,
    keyThemes,
    model: MODEL,
    usage: [usage],
  };
}
