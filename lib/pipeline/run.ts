/**
 * The new pipeline's runner: ask each provider plainly (lib/answers), store a
 * Run and one Answer per provider per question with its citations, then run
 * the one extraction pass over every answer (lib/extraction).
 *
 * No provider is asked for a JSON block; structured output belongs only to
 * the extraction model. Used by the tracker and the public site.
 */
import type { PrismaClient, RunKind, RunStatus } from "@/app/generated/prisma/client";
import {
  PROVIDERS,
  getModels,
  toProviderError,
  type AskResult,
  type ModelChoice,
  type ProviderError,
  type ProviderId,
  type UserLocation,
} from "@/lib/answers";
import { answerCreateData, extractAndStore, failedAnswerCreateData, providerCitationRows } from "@/lib/extraction";
import type { ResponsesClient } from "@/lib/extraction";
import { failedCallEstimateUsd } from "@/lib/answers/estimates";
import { spentSoFar } from "@/lib/worker/active-runs";

export interface RunPipelineOptions {
  kind: RunKind;
  /** Watch item topic or public-site topic; also given to the extraction. */
  topic: string;
  /** Questions to ask, word for word. Defaults to the topic itself. */
  questions?: { text: string; questionId?: string; repeat?: number }[];
  location?: UserLocation;
  /** Providers to ask. Defaults to all four. */
  providers?: ProviderId[];
  watchItemId?: string;
  /**
   * An existing Run (status running) to store the answers on, instead of
   * creating one: a snapshot creates its Run first so its fresh question set
   * can be tied to it (lib/questions questionsForSnapshot).
   */
  runId?: string;
  /** Sub-topics themes can be tied to (name → id). */
  subTopics?: { id: string; name: string }[];
  note?: string;
  /** Answers extracted at once. */
  extractionConcurrency?: number;
  /** Provider calls in flight at once. Defaults to all at once. */
  askConcurrency?: number;
  /** Aborts the provider calls (an aborted call is stored as a timeout). */
  signal?: AbortSignal;
  /** Aborts extractions. Defaults to `signal`; set it later to leave extraction time after a deadline. */
  extractionSignal?: AbortSignal;
  /** Called as each provider call lands, before its extraction. */
  onAnswer?: (event: AnswerEvent) => void;
  /**
   * Called just before each provider call is sent. It may abort `signal` (a
   * spending cap that can't cover another call), in which case the call isn't
   * made. Calls it lets through are reported to onAnswer.
   */
  beforeAsk?: () => void;
  /** Called with each extraction's cost as it finishes. */
  onExtracted?: (costUsd: number) => void;
  /** Test seam for the extraction client. */
  extractionClient?: ResponsesClient;
  /**
   * Ask these providers with these model-list rows instead of the current
   * ones. The model watcher (task 4.5) uses it to ask the retired model and
   * its replacement the same questions on a switch day.
   */
  models?: Partial<Record<ProviderId, ModelChoice>>;
}

export type AnswerEvent =
  | { provider: ProviderId; question: string; ok: true; result: AskResult }
  | {
      provider: ProviderId;
      question: string;
      ok: false;
      error: ProviderError;
      /** Whether the call was sent (false: skipped while still queued). */
      sent: boolean;
      /** What the failed call is counted at against the caps (lib/answers/estimates). */
      estimatedCostUsd: number;
    };

export interface RunPipelineResult {
  runId: string;
  status: RunStatus;
  answers: {
    /** Empty when the answer couldn't be stored. */
    answerId: string;
    provider: ProviderId;
    question: string;
    ok: boolean;
    answerCostUsd: number;
    extraction?: { extractionId: string; ok: boolean; costUsd: number; error?: string };
    error?: string;
    /** Why the provider call failed, when it did. */
    errorKind?: ProviderError["kind"];
  }[];
  costUsd: number;
}

/** Run at most `limit` tasks at once; later calls wait for a free slot. */
function limiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<R>(task: () => Promise<R>): Promise<R> {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Swallow a callback's error so it can't fail the run. */
function safely(fn: () => void) {
  try {
    fn();
  } catch (err) {
    console.error("[Pipeline] onAnswer callback failed:", err);
  }
}

export async function runPipeline(db: PrismaClient, options: RunPipelineOptions): Promise<RunPipelineResult> {
  const { topic, location, signal } = options;
  const extractionSignal = options.extractionSignal ?? signal;
  const extractSlot = limiter(options.extractionConcurrency ?? 4);
  const askSlot = options.askConcurrency ? limiter(options.askConcurrency) : <R>(task: () => Promise<R>) => task();
  const providerIds = options.providers ?? (Object.keys(PROVIDERS) as ProviderId[]);
  const questions = options.questions?.length ? options.questions : [{ text: topic }];
  const subTopicIds = Object.fromEntries((options.subTopics ?? []).map((s) => [s.name, s.id]));

  const run = options.runId
    ? { id: options.runId }
    : await db.run.create({
        data: {
          kind: options.kind,
          topic,
          watchItemId: options.watchItemId ?? null,
          askCity: location?.city ?? null,
          askRegion: location?.region ?? null,
          askCountry: location?.country ?? null,
          askTimezone: location?.timezone ?? null,
          note: options.note ?? null,
        },
        select: { id: true },
      });

  // Each provider's current model from the registry (task 2.4), read once per run.
  let models: Awaited<ReturnType<typeof getModels>>;
  try {
    models = { ...(await getModels()), ...options.models };
  } catch (err) {
    await db.run.update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), costUsd: 0, note: `pipeline: ${errorText(err)}`.slice(0, 1000) } }).catch(() => {});
    throw err;
  }

  // Ask every provider every question, in parallel; store each answer (or
  // failure) with the provider's citations as it lands, then run the one
  // extraction pass over it straight away rather than waiting for the rest.
  // Each call's task catches its own errors (a failed database write becomes a
  // failed answer, with what the call cost), so one failure never drops the
  // other calls' costs or leaves the Run "running" (task 6.6, code review M5).
  type Stored = RunPipelineResult["answers"][number] & {
    answerText?: string;
    providerUrls: string[];
    citationCount: number;
  };
  const calls = questions.flatMap((q) => providerIds.map((provider) => ({ q, provider })));
  const task = async ({ q, provider }: (typeof calls)[number]): Promise<Stored> => {
    const ctx = { runId: run.id, question: q.text, questionId: q.questionId, repeat: q.repeat };
    const base = { answerId: "", provider, question: q.text, providerUrls: [] as string[], citationCount: 0 };
    let result: AskResult;
    let sent = false;
    try {
      result = await askSlot(() => {
        options.beforeAsk?.();
        // A call still queued when the run is stopped isn't made.
        if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
        sent = true;
        return PROVIDERS[provider].ask(q.text, { location, signal, settings: models[provider] });
      });
    } catch (err) {
      const error = toProviderError(provider, err);
      const estimate = failedCallEstimateUsd(error.kind, sent);
      safely(() => options.onAnswer?.({ provider, question: q.text, ok: false, error, sent, estimatedCostUsd: estimate }));
      const failed: Stored = { ...base, ok: false, answerCostUsd: estimate, error: `${error.kind}: ${error.message}`, errorKind: error.kind };
      try {
        const row = await db.answer.create({
          data: {
            ...failedAnswerCreateData(ctx, models[provider], error, location ?? null),
            ...(estimate ? { costUsd: estimate, costNote: `estimate: the call failed after it was sent (${error.kind})` } : {}),
          },
          select: { id: true },
        });
        failed.answerId = row.id;
      } catch (dbErr) {
        failed.error = `${failed.error}; not stored: ${errorText(dbErr)}`;
      }
      return failed;
    }
    safely(() => options.onAnswer?.({ provider, question: q.text, ok: true, result }));
    const citations = providerCitationRows(result.sources);
    const s: Stored = { ...base, ok: true, answerCostUsd: result.cost.usd, answerText: result.answer, providerUrls: citations.map((c) => c.url), citationCount: citations.length };
    try {
      const row = await db.answer.create({
        data: { ...answerCreateData(ctx, result), citations: { create: citations } },
        select: { id: true },
      });
      s.answerId = row.id;
    } catch (dbErr) {
      // Paid for but not stored: count it, mark the answer failed.
      return { ...s, ok: false, answerText: undefined, error: `answer not stored: ${errorText(dbErr)}` };
    }
    if (s.answerText) {
      try {
        s.extraction = await extractSlot(() =>
          extractAndStore(
            db,
            { id: s.answerId, answer: s.answerText!, providerUrls: s.providerUrls, nextCitationPosition: s.citationCount },
            { topic, question: s.question, subTopics: options.subTopics?.map((t) => t.name) },
            { subTopicIds, client: options.extractionClient, signal: extractionSignal }
          )
        );
      } catch (err) {
        s.extraction = { extractionId: "", ok: false, costUsd: 0, error: errorText(err) };
      }
      safely(() => options.onExtracted?.(s.extraction!.costUsd));
    }
    return s;
  };

  let stored: Stored[];
  try {
    stored = await Promise.all(calls.map(task));
  } catch (err) {
    // Only a bug gets here (every task catches its own errors). Close the Run
    // with what its stored answers cost, so it doesn't block the item.
    const costUsd = await spentSoFar(db, run.id).catch(() => null);
    await db.run
      .update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date(), costUsd, note: `pipeline: ${errorText(err)}`.slice(0, 1000) } })
      .catch(() => {});
    throw err;
  }

  const answered = stored.filter((s) => s.ok).length;
  const allExtracted = stored.every((s) => !s.ok || s.extraction?.ok);
  const status: RunStatus = answered === 0 ? "failed" : answered === stored.length && allExtracted ? "complete" : "partial";
  const costUsd = stored.reduce((sum, s) => sum + s.answerCostUsd + (s.extraction?.costUsd ?? 0), 0);

  await db.run.update({
    where: { id: run.id },
    data: { status, finishedAt: new Date(), costUsd: Math.round(costUsd * 1e8) / 1e8 },
  });

  return {
    runId: run.id,
    status,
    costUsd,
    answers: stored.map((s) => ({
      answerId: s.answerId,
      provider: s.provider,
      question: s.question,
      ok: s.ok,
      answerCostUsd: s.answerCostUsd,
      extraction: s.extraction,
      error: s.error,
      errorKind: s.errorKind,
    })),
  };
}
