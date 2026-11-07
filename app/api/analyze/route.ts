import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { guardAnalyzeRequest } from "@/lib/guards/analyze-request";
import { recordSpend, runSpendUsd, UNMETERED_RUN_ESTIMATE_USD } from "@/lib/guards/spend";
import { reportError } from "@above-public-affairs/error-reporter";
import { providerErrorLabel, type ProviderId } from "@/lib/answers";
import { runPipeline, type AnswerEvent, type RunPipelineResult } from "@/lib/pipeline/run";
import { runPointer } from "@/lib/results/stored-result";

// The public site asks each AI the visitor's topic once, plainly, with the
// AI's own web search on (lib/answers), then runs the one extraction pass over
// every answer (lib/extraction). No location is sent: the public site has
// never collected one.

// One deadline for the whole run, under the browser's 180s timeout in
// app/page.tsx, so the visitor never sees a timeout for a run that then
// finished and saved. Provider calls stop ANSWER_RESERVE_MS before it, so a
// late answer can still be extracted; extraction stops SAVE_RESERVE_MS before
// it, so the database write still fits.
const RUN_DEADLINE_MS = 170_000;
const ANSWER_RESERVE_MS = 30_000;
const SAVE_RESERVE_MS = 10_000;

// Proxies and load balancers drop a connection that sends nothing for a while,
// and providers can stay silent for over a minute. An SSE comment line keeps
// the stream alive; the browser's parser skips anything not starting "data: ".
const HEARTBEAT_MS = 15_000;

const PROVIDER_KEYS: Record<ProviderId, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_AI_API_KEY",
  grok: "XAI_API_KEY",
};

function configuredProviders(): ProviderId[] {
  return (Object.keys(PROVIDER_KEYS) as ProviderId[]).filter((p) => !!process.env[PROVIDER_KEYS[p]]);
}

/** An AbortSignal that fires `ms` from now, and a way to stop the timer. */
function deadline(ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timed out after ${Math.round(ms / 1000)}s`)),
    Math.max(1_000, ms)
  );
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export async function POST(request: NextRequest) {
  // Kill switch, input caps, daily spend cap and rate limit (lib/guards)
  const guard = await guardAnalyzeRequest(request);
  if (!guard.ok) return guard.response;
  const topic = guard.topic;

  const providers = configuredProviders();
  if (providers.length === 0) {
    return NextResponse.json({ error: "No AI providers are configured" }, { status: 500 });
  }

  // Stream SSE events for real-time progress
  const { signal } = request;
  const encoder = new TextEncoder();
  // The controller can stop accepting writes for two reasons: we finished and
  // closed it, or the client went away and the platform cancelled the stream
  // underneath us. Either way `close()` and `enqueue()` throw, so every write
  // and the close itself go through the guarded helpers below.
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

      const answerDeadline = deadline(RUN_DEADLINE_MS - ANSWER_RESERVE_MS);
      const extractionDeadline = deadline(RUN_DEADLINE_MS - SAVE_RESERVE_MS);
      const heartbeat = setInterval(() => {
        if (streamClosed || signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          // Stream already closed
        }
      }, HEARTBEAT_MS);

      // Set once the providers have been asked, so a failure after that point
      // still counts against the daily spend cap.
      let asked = false;
      let spendRecorded = false;
      try {
        // A visitor who left before anything was asked has cost nothing, so
        // skip the run. Past this point it's paid for and is saved even if
        // they leave: the provider calls deliberately don't use the request's
        // signal. `finally` closes the stream.
        if (signal.aborted) return;

        emit({ stage: "querying", providers });
        let landed = 0;
        const onAnswer = (e: AnswerEvent) => {
          landed++;
          if (e.ok && e.result.answer.trim()) {
            emit({ stage: "provider_done", provider: e.provider });
          } else {
            const reason = e.ok ? "Returned an empty answer" : providerErrorLabel(e.error.kind);
            console.warn(`[${e.provider}] Provider failed: ${e.ok ? reason : e.error.message}`);
            reportError({
              project: "ai-topic-explorer",
              category: "provider_failure",
              provider: e.provider,
              message: reason,
              rawError: e.ok ? undefined : e.error,
              context: {
                topic,
                stage: "public_answer",
                ...(e.ok
                  ? { model: e.result.model, finishReason: e.result.finishReason }
                  : { kind: e.error.kind, status: e.error.status, detail: e.error.message }),
              },
            });
            emit({ stage: "provider_failed", provider: e.provider, reason });
          }
          // Every AI has answered or failed; what's left is extraction.
          if (landed === providers.length) emit({ stage: "merging" });
        };

        asked = true;
        let result: RunPipelineResult;
        try {
          result = await runPipeline(prisma, {
            kind: "public",
            topic,
            providers,
            signal: answerDeadline.signal,
            extractionSignal: extractionDeadline.signal,
            onAnswer,
          });
        } finally {
          answerDeadline.clear();
          extractionDeadline.clear();
        }

        // Count this run against the daily spend cap, before any early return.
        await recordSpend(runSpendUsd(result));
        spendRecorded = true;

        const succeeded = result.answers.filter((a) => a.ok && a.extraction).length;
        console.log(
          `[Analyze] run ${result.runId} ${result.status}: ${succeeded}/${result.answers.length} answered, $${result.costUsd.toFixed(4)}`
        );
        for (const a of result.answers) {
          if (a.extraction && !a.extraction.ok) {
            reportError({
              project: "ai-topic-explorer",
              category: "extraction_failure",
              provider: a.provider,
              message: `Extraction failed: ${a.extraction.error ?? "unknown error"}`,
              context: { topic, runId: result.runId, answerId: a.answerId },
            });
          }
        }

        if (result.status === "failed" || succeeded === 0) {
          emit({ stage: "error", message: "All AI providers failed" });
          return;
        }

        // Save even if the visitor has left: the providers are already paid
        // for, and the run is still worth keeping. Retry once on failure.
        let analysisId: string | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const analysis = await prisma.analysis.create({
              data: { topic, result: { ...runPointer(topic, result.runId) } },
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
              context: { topic, runId: result.runId },
            });
            if (attempt === 0) await new Promise((r) => setTimeout(r, 1000));
          }
        }

        if (!analysisId) {
          emit({ stage: "error", message: "Failed to save results. Please try again." });
          return;
        }

        if (signal.aborted) {
          console.log(`[Analyze] Visitor left mid-analysis; saved result ${analysisId}`);
        }
        emit({ stage: "complete", id: analysisId });
      } catch (err) {
        console.error("Analysis stream error:", err);
        // The run failed partway (most likely the database), so its real cost
        // is unknown: count a conservative estimate rather than nothing.
        if (asked && !spendRecorded) await recordSpend(UNMETERED_RUN_ESTIMATE_USD);
        reportError({
          project: "ai-topic-explorer",
          category: "stream_error",
          message: err instanceof Error ? err.message : String(err),
          rawError: err,
          context: { topic },
        });
        emit({ stage: "error", message: "Analysis failed. Please try again." });
      } finally {
        answerDeadline.clear();
        extractionDeadline.clear();
        clearInterval(heartbeat);
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
