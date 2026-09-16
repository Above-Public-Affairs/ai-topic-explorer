import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { reportError } from "canter-error-reporter";
import { analyzeWithClaude } from "@/lib/ai-clients/claude";
import { analyzeWithOpenAI } from "@/lib/ai-clients/openai";
import { analyzeWithGemini } from "@/lib/ai-clients/gemini";
import { analyzeWithPerplexity } from "@/lib/ai-clients/perplexity";
import { analyzeWithGrok } from "@/lib/ai-clients/grok";
import { expandQuery } from "@/lib/analysis/query-expansion";
import {
  calculateWordFrequency,
  mergeWordFrequencies,
  topicToWords,
} from "@/lib/analysis/word-frequency";
import { mergeEntities } from "@/lib/analysis/merge-entities";
import { mergeCitations } from "@/lib/analysis/merge-citations";
import { mergeKeyThemes } from "@/lib/analysis/merge-themes";
import type {
  AIResponse,
  AnalysisResult,
  Provider,
  WordFrequency,
  KeyTheme,
  ExtractedEntities,
  Citation,
  TokenUsage,
} from "@/lib/types";

type AnalyzeFn = (query: string, signal?: AbortSignal) => Promise<AIResponse>;

// Each provider query is a full generation (up to 4096 output tokens). Under
// load — this route fires every expanded query at every provider at once — token
// throughput drops and a normal generation can run well past a minute, so the
// deadline needs real headroom above the typical case or healthy requests get
// killed mid-stream and reported as failures.
const PROVIDER_TIMEOUT_MS = 150_000; // 150 seconds per provider query
const EXPANSION_TIMEOUT_MS = 15_000; // 15 seconds for query expansion

// Every expanded query fires at every provider, so a single analysis opens all
// of a provider's subtopic queries in the same instant. That burst is what trips
// Perplexity's rate limiter — the per-minute volume is small, but it arrives all
// at once. Spacing the starts costs ~1.6s on the last query out of a 150s budget
// (and the offset is added back to that query's deadline below) and lets a
// burst-based limiter drain between requests. A limiter enforcing a strict
// per-minute count is unaffected by spacing; the SDK's retry-after-aware
// retries in lib/ai-clients cover that case.
const QUERY_STAGGER_MS = 400;

/** Abortable sleep — rejects rather than proceeding if the deadline fires first. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("Aborted before request start"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new Error("Aborted before request start"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Run `task` with a timeout. On timeout the task's AbortSignal is fired so the
 * underlying request is actually cancelled instead of leaking in the background.
 * `label` is included in the error so reports identify what timed out.
 */
function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  const controller = new AbortController();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`Timed out after ${ms / 1000}s (${label})`));
    }, ms);
    task(controller.signal).then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/** Categorize an error into a user-friendly reason */
function categorizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);

  if (message.includes("Timed out after")) return message;
  if (message.includes("429") || message.toLowerCase().includes("rate limit"))
    return "Rate limited — too many requests";
  if (message.includes("529") || message.includes("overloaded"))
    return "API overloaded — try again shortly";
  if (message.includes("401") || message.includes("authentication") || message.includes("invalid.*key"))
    return "Authentication error — invalid API key";
  if (message.includes("403") || message.includes("permission"))
    return "Permission denied";
  if (message.includes("500") || message.includes("internal server error"))
    return "Provider API internal error";
  if (message.includes("ECONNREFUSED") || message.includes("ENOTFOUND") || message.includes("fetch failed"))
    return "Network error — could not reach provider";
  if (message.includes("All") && message.includes("subtopic queries failed"))
    return "All subtopic queries failed";

  // A TypeError et al. never came from the provider's API — it's our own bug
  // handling a response. Report the detail, but don't put a raw JS message in
  // front of the user.
  if (
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError
  )
    return "Could not process the provider's response";

  // Truncate long messages
  return message.length > 120 ? message.slice(0, 120) + "…" : message;
}

/**
 * `categorizeError` collapses a failure to one short line for display, which
 * throws away the detail that says *which* limit was hit. Pull the provider's
 * own diagnostics off the SDK error so the report is actionable — a 429 with a
 * `retry-after` is a rate limit that will clear, a 429 without one usually
 * means a quota or credit ceiling that won't.
 */
function providerErrorDetail(err: unknown): Record<string, unknown> {
  const detail: Record<string, unknown> = {};
  if (typeof err !== "object" || err === null) return detail;

  const candidate = err as {
    status?: unknown;
    headers?: unknown;
    error?: unknown;
  };

  if (typeof candidate.status === "number") detail.status = candidate.status;

  // SDK errors carry a Headers instance; guard because the shape isn't declared.
  const headers = candidate.headers;
  if (headers && typeof (headers as Headers).get === "function") {
    const retryAfter =
      (headers as Headers).get("retry-after") ??
      (headers as Headers).get("retry-after-ms");
    if (retryAfter) detail.retryAfter = retryAfter;
  }

  // The parsed response body usually holds the provider's own explanation.
  const body = candidate.error;
  if (typeof body === "string") {
    detail.providerMessage = body.slice(0, 300);
  } else if (typeof body === "object" && body !== null) {
    const message = (body as { message?: unknown }).message;
    detail.providerMessage =
      typeof message === "string"
        ? message.slice(0, 300)
        : JSON.stringify(body).slice(0, 300);
  }

  return detail;
}

function getConfiguredProviders(): { provider: Provider; analyze: AnalyzeFn }[] {
  const providers: { provider: Provider; analyze: AnalyzeFn }[] = [];

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({ provider: "claude", analyze: analyzeWithClaude });
  }
  if (process.env.OPENAI_API_KEY) {
    providers.push({ provider: "openai", analyze: analyzeWithOpenAI });
  }
  if (process.env.GOOGLE_AI_API_KEY) {
    providers.push({ provider: "gemini", analyze: analyzeWithGemini });
  }
  if (process.env.PERPLEXITY_API_KEY) {
    providers.push({ provider: "perplexity", analyze: analyzeWithPerplexity });
  }
  if (process.env.XAI_API_KEY) {
    providers.push({ provider: "grok", analyze: analyzeWithGrok });
  }

  return providers;
}

/** Merge multiple AIResponses from subtopic queries into a single AIResponse per provider */
function mergeProviderResponses(responses: AIResponse[]): AIResponse {
  const rawTexts = responses.map((r) => r.rawText);
  const provider = responses[0].provider;
  const allEntities = responses.map((r) => ({ provider, entities: r.entities }));
  const allCitations = responses.flatMap((r) => r.citations);
  const allKeyThemes = responses.map((r) => r.keyThemes);
  const allUsage = responses.flatMap((r) => r.usage || []);
  const allRelatedQuestions = [
    ...new Set(responses.flatMap((r) => r.relatedQuestions || [])),
  ];
  const allQuotedPhrases = [
    ...new Map(
      responses
        .flatMap((r) => r.quotedPhrases || [])
        .map((q) => [q.phrase.toLowerCase(), q] as const)
    ).values(),
  ]
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 15);

  return {
    provider,
    rawText: rawTexts.join("\n\n"),
    entities: mergeEntities(allEntities),
    citations: allCitations,
    keyThemes: mergeKeyThemes(...allKeyThemes),
    model: responses[0].model,
    usage: allUsage,
    ...(allRelatedQuestions.length > 0 && { relatedQuestions: allRelatedQuestions }),
    ...(allQuotedPhrases.length > 0 && { quotedPhrases: allQuotedPhrases }),
  };
}

export async function POST(request: NextRequest) {
  // Kill switch
  if (process.env.ANALYSIS_ENABLED === "false") {
    return NextResponse.json(
      { error: "Analysis is temporarily unavailable" },
      { status: 503 }
    );
  }

  // Rate limiting
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";

  const rateLimit = checkRateLimit(ip);
  if (!rateLimit.allowed) {
    const retryMinutes = Math.ceil((rateLimit.retryAfterMs || 0) / 60000);
    reportError({
      project: "ai-topic-explorer",
      category: "rate_limit",
      message: `Rate limit hit: ${retryMinutes} min retry`,
    });
    return NextResponse.json(
      {
        error: `You've reached the analysis limit. Try again in ${retryMinutes} minute${retryMinutes === 1 ? "" : "s"}.`,
      },
      { status: 429 }
    );
  }

  // Parse and validate input
  let topic: string;
  try {
    const body = await request.json();
    topic = body.topic;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
    return NextResponse.json(
      { error: "Please provide a topic to analyze" },
      { status: 400 }
    );
  }

  topic = topic.trim();

  // Get configured providers
  const providers = getConfiguredProviders();
  if (providers.length === 0) {
    return NextResponse.json(
      { error: "No AI providers are configured" },
      { status: 500 }
    );
  }

  // Stream SSE events for real-time progress
  const { signal } = request;
  const encoder = new TextEncoder();
  // The controller can stop accepting writes for two reasons: we finished and
  // closed it, or the client went away and the platform cancelled the stream
  // underneath us. Either way `close()` and `enqueue()` throw
  // "Invalid state: Controller is already closed", so every write and the close
  // itself go through the guarded helpers below rather than touching the
  // controller directly.
  let streamClosed = false;
  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: Record<string, unknown>) {
        if (streamClosed || signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream already closed
        }
      }

      /** Close once, and never throw if the client already tore the stream down. */
      function closeStream() {
        if (streamClosed) return;
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // Already closed or cancelled — nothing left to do.
        }
      }

      try {
        // Step 1: Query expansion
        emit({ stage: "expanding" });

        const allUsage: TokenUsage[] = [];
        let expandedQueries: string[];
        try {
          const expansion = await withTimeout(() => expandQuery(topic), EXPANSION_TIMEOUT_MS, "expansion");
          expandedQueries = expansion.queries;
          if (expansion.usage.inputTokens > 0) {
            allUsage.push(expansion.usage);
          }
          console.log(
            `[Query Expansion] "${topic}" → ${expandedQueries.length} queries:`,
            expandedQueries
          );
        } catch (e) {
          console.warn("Query expansion failed, using original topic:", e);
          reportError({
      project: "ai-topic-explorer",
            category: "query_expansion_error",
            message: e instanceof Error ? e.message : String(e),
            rawError: e,
            context: { topic },
          });
          expandedQueries = [topic];
        }

        // Check if client disconnected before expensive AI calls.
        // `finally` closes the stream — closing here too would double-close.
        if (signal.aborted) return;

        // Step 2: Run all queries × all providers in parallel
        const providerNames = providers.map((p) => p.provider);
        emit({ stage: "querying", providers: providerNames });

        const providerResults = await Promise.allSettled(
          providers.map(async ({ provider, analyze }) => {
            try {
              const queryResults = await Promise.allSettled(
                expandedQueries.map((query, i) => {
                  const offset = i * QUERY_STAGGER_MS;
                  return withTimeout(
                    async (signal) => {
                      if (offset > 0) await sleep(offset, signal);
                      return analyze(query, signal);
                    },
                    // Add the stagger back so every query gets the same
                    // generation budget regardless of its place in the queue.
                    PROVIDER_TIMEOUT_MS + offset,
                    `${provider}: "${query.slice(0, 50)}"`
                  );
                })
              );

              const successful = queryResults
                .filter(
                  (r): r is PromiseFulfilledResult<AIResponse> =>
                    r.status === "fulfilled"
                )
                .map((r) => r.value);

              const failed = queryResults.flatMap((r, i) =>
                r.status === "rejected"
                  ? [{ reason: r.reason, query: expandedQueries[i] }]
                  : []
              );
              for (const f of failed) {
                const reason = categorizeError(f.reason);
                console.warn(`[${provider}] Subtopic query failed: ${reason}`);
                reportError({
                  project: "ai-topic-explorer",
                  category: "provider_failure",
                  provider,
                  message: reason,
                  rawError: f.reason,
                  context: {
                    topic,
                    stage: "subtopic_query",
                    query: f.query,
                    queryCount: expandedQueries.length,
                    // Whether this failure actually cost the user anything: with
                    // other queries fulfilled the provider still returns a
                    // (thinner) result, which separates degraded from broken.
                    succeededQueries: successful.length,
                    failedQueries: failed.length,
                    ...providerErrorDetail(f.reason),
                  },
                });
              }

              if (successful.length === 0) {
                // Use the first failure's reason as the representative error
                const firstReason = failed.length > 0
                  ? categorizeError(failed[0].reason)
                  : "Unknown error";
                throw new Error(firstReason);
              }

              const merged = mergeProviderResponses(successful);
              emit({ stage: "provider_done", provider });
              return merged;
            } catch (err) {
              const reason = categorizeError(err);
              console.error(`[${provider}] Provider failed: ${reason}`);
              reportError({
                project: "ai-topic-explorer",
                category: "provider_failure",
                provider,
                message: reason,
                rawError: err,
                context: {
                  topic,
                  stage: "provider",
                  queryCount: expandedQueries.length,
                  ...providerErrorDetail(err),
                },
              });
              emit({ stage: "provider_failed", provider, reason });
              throw err;
            }
          })
        );

        // Process results
        const responses: AnalysisResult["responses"] = {
          claude: null,
          openai: null,
          gemini: null,
          perplexity: null,
          grok: null,
        };
        const errors: AnalysisResult["errors"] = {};
        const wordFreqLists: WordFrequency[][] = [];
        const keyThemeLists: KeyTheme[][] = [];
        const entityLists: { provider: Provider; entities: ExtractedEntities }[] = [];
        const citationsByProvider: { provider: Provider; citations: Citation[] }[] = [];
        const topicWordSet = topicToWords(topic);

        for (let i = 0; i < providers.length; i++) {
          const { provider } = providers[i];
          const result = providerResults[i];

          if (result.status === "fulfilled") {
            responses[provider] = result.value;

            if (provider !== "perplexity" && provider !== "grok") {
              wordFreqLists.push(calculateWordFrequency(result.value.rawText, topicWordSet));
              keyThemeLists.push(result.value.keyThemes);
              entityLists.push({ provider, entities: result.value.entities });
            }

            citationsByProvider.push({
              provider,
              citations: result.value.citations,
            });
            if (result.value.usage) {
              allUsage.push(...result.value.usage);
            }
          } else {
            errors[provider] = categorizeError(result.reason);
          }
        }

        // Log total usage
        const totalInput = allUsage.reduce((sum, u) => sum + u.inputTokens, 0);
        const totalOutput = allUsage.reduce((sum, u) => sum + u.outputTokens, 0);
        const expansionUsage = allUsage.filter((u) => u.purpose === "expansion");
        const analysisUsage = allUsage.filter((u) => u.purpose === "analysis");
        console.log(
          `[Token Usage] Total: ${totalInput} in / ${totalOutput} out | ` +
            `Expansion: ${expansionUsage.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0)} | ` +
            `Analysis: ${analysisUsage.reduce((s, u) => s + u.inputTokens + u.outputTokens, 0)}`
        );

        // Check if all providers failed
        const successCount = Object.values(responses).filter(Boolean).length;
        if (successCount === 0) {
          emit({ stage: "error", message: "All AI providers failed" });
          return;
        }

        // Step 3: Merge results
        emit({ stage: "merging" });

        const combinedWordFrequencies = mergeWordFrequencies(...wordFreqLists);
        const combinedKeyThemes = mergeKeyThemes(...keyThemeLists);
        const combinedEntities = mergeEntities(entityLists);
        const combinedCitations = mergeCitations(citationsByProvider);

        const analysisResult: AnalysisResult = {
          topic,
          expandedQueries,
          responses,
          errors,
          combinedWordFrequencies,
          combinedKeyThemes,
          combinedEntities,
          combinedCitations,
          tokenUsage: allUsage,
        };

        // Check if client disconnected before DB save
        if (signal.aborted) return;

        // Save to database (retry once on failure)
        let analysisId: string | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const analysis = await prisma.analysis.create({
              data: {
                topic,
                result: JSON.parse(JSON.stringify(analysisResult)),
              },
            });
            analysisId = analysis.id;
            break;
          } catch (e) {
            console.error(`Failed to save analysis (attempt ${attempt + 1}):`, e);
            reportError({
      project: "ai-topic-explorer",
              category: "database_error",
              message: `Failed to save analysis (attempt ${attempt + 1})`,
              rawError: e,
              context: { topic },
            });
            if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
          }
        }

        if (!analysisId) {
          emit({ stage: "error", message: "Failed to save results. Please try again." });
          return;
        }

        emit({ stage: "complete", id: analysisId });
      } catch (err) {
        console.error("Analysis stream error:", err);
        // A client that navigates away aborts the request, which makes the
        // in-flight work reject. That is the user leaving, not a fault worth
        // paging on, so only report failures that happened on a live stream.
        if (!signal.aborted) {
          reportError({
            project: "ai-topic-explorer",
            category: "stream_error",
            message: err instanceof Error ? err.message : String(err),
            rawError: err,
            context: { topic },
          });
        }
        emit({ stage: "error", message: "Analysis failed. Please try again." });
      } finally {
        closeStream();
      }
    },
    cancel() {
      // The client disconnected; the platform has already torn the stream down,
      // so mark it closed and let the in-flight handler unwind quietly.
      streamClosed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
