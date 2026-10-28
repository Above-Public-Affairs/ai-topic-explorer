import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  type GenerateContentResult,
} from "@google/generative-ai";
import type { AIResponse, TokenUsage } from "@/lib/types";
import { PROMPT_TEMPLATE, parseStructuredData, extractRawText } from "./shared";

// gemini-2.5-flash is closed to new Google projects ("no longer available to new
// users"), which the rotated key's project is. thinkingBudget 0 still turns
// thinking off on the 3.x Flash models.
const MODEL = "gemini-3.5-flash";

// Lighter model used when MODEL stays busy after retries. It rejects
// thinkingBudget 0; thinkingLevel "minimal" is its lowest setting.
const FALLBACK_MODEL = "gemini-3.5-flash-lite";

// Google answers "high demand" (503), quota/rate limits (429) and the odd 500
// with errors that usually clear within seconds, and this SDK never retries on
// its own. Every other status (bad key, bad request, unknown model) is final.
const RETRYABLE_STATUSES = new Set([429, 500, 503]);

// Waits between attempts on MODEL, so 3 attempts in all. Failed attempts come
// back fast, so this costs a few seconds of a 150s budget.
const RETRY_DELAYS_MS = [1_000, 3_000];

// A 429 can name its own wait (RetryInfo.retryDelay). Honor it when short;
// anything longer is a quota window that won't clear in time, so go straight
// to the fallback model, which has its own quota.
const MAX_SERVER_RETRY_DELAY_MS = 8_000;

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

/** HTTP status from a GoogleGenerativeAIFetchError, if the error carries one. */
function statusOf(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

function isRetryable(err: unknown): boolean {
  const status = statusOf(err);
  return status !== null && RETRYABLE_STATUSES.has(status);
}

/** The wait a 429 asks for (RetryInfo.retryDelay, e.g. "34s"), in ms. */
function serverRetryDelayMs(err: unknown): number | null {
  const details = (err as { errorDetails?: unknown } | null)?.errorDetails;
  if (!Array.isArray(details)) return null;
  for (const detail of details) {
    const delay = (detail as { retryDelay?: unknown } | null)?.retryDelay;
    if (typeof delay === "string") {
      const seconds = parseFloat(delay);
      if (Number.isFinite(seconds)) return seconds * 1000;
    }
  }
  return null;
}

/** Abortable wait, so a retry pause never outlives the caller's timeout. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Aborted during Gemini retry wait"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Aborted during Gemini retry wait"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function generate(
  modelName: string,
  thinkingConfig: Record<string, unknown>,
  prompt: string,
  signal?: AbortSignal
): Promise<GenerateContentResult> {
  const model = genAI.getGenerativeModel({
    model: modelName,
    safetySettings: SAFETY_SETTINGS,
    generationConfig: { thinkingConfig } as Record<string, unknown>,
  });
  // Pass the signal so a timed-out request is actually cancelled rather than
  // left running in the background.
  return model.generateContent(prompt, { signal });
}

/** Call MODEL, retrying the transient statuses above. Throws the last error. */
async function generateWithRetries(
  prompt: string,
  query: string,
  signal?: AbortSignal
): Promise<GenerateContentResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await generate(MODEL, { thinkingBudget: 0 }, prompt, signal);
    } catch (err) {
      if (!isRetryable(err) || attempt >= RETRY_DELAYS_MS.length) throw err;
      const serverDelay = serverRetryDelayMs(err);
      if (serverDelay !== null && serverDelay > MAX_SERVER_RETRY_DELAY_MS) throw err;
      // Jitter so a provider's concurrent subtopic queries don't retry in lockstep.
      const delay = (serverDelay ?? RETRY_DELAYS_MS[attempt]) * (1 + Math.random() * 0.3);
      console.warn(
        `[Analysis: Gemini] ${MODEL} returned ${statusOf(err)} for "${query.slice(0, 40)}..."; retry ${attempt + 1} in ${Math.round(delay)}ms`
      );
      await wait(delay, signal);
    }
  }
}

export async function analyzeWithGemini(
  query: string,
  signal?: AbortSignal
): Promise<AIResponse> {
  const prompt = PROMPT_TEMPLATE(query);

  let servedBy = MODEL;
  let result: GenerateContentResult;
  try {
    result = await generateWithRetries(prompt, query, signal);
  } catch (err) {
    if (!isRetryable(err) || signal?.aborted) throw err;
    // Thinner answers beat a dropped query. The response records which model
    // actually answered.
    console.warn(
      `[Analysis: Gemini] ${MODEL} still unavailable (${statusOf(err)}); falling back to ${FALLBACK_MODEL}`
    );
    servedBy = FALLBACK_MODEL;
    result = await generate(FALLBACK_MODEL, { thinkingLevel: "minimal" }, prompt, signal);
  }

  const response = result.response;
  const responseText = response.text();

  const usageMetadata = response.usageMetadata;
  const usage: TokenUsage = {
    inputTokens: usageMetadata?.promptTokenCount || 0,
    outputTokens: usageMetadata?.candidatesTokenCount || 0,
    purpose: "analysis",
  };

  console.log(
    `[Analysis: Gemini] Query: "${query.slice(0, 60)}..." — Tokens — input: ${usage.inputTokens}, output: ${usage.outputTokens}${servedBy === MODEL ? "" : ` (${servedBy})`}`
  );

  const { entities, citations, keyThemes } = parseStructuredData(responseText, "Gemini");

  return {
    provider: "gemini",
    rawText: extractRawText(responseText),
    entities,
    citations,
    keyThemes,
    model: servedBy,
    usage: [usage],
  };
}
