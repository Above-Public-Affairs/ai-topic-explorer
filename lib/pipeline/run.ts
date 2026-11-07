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
  type ProviderError,
  type ProviderId,
  type UserLocation,
} from "@/lib/answers";
import { answerCreateData, extractAndStore, failedAnswerCreateData, providerCitationRows } from "@/lib/extraction";
import type { ResponsesClient } from "@/lib/extraction";

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
  /** Sub-topics themes can be tied to (name → id). */
  subTopics?: { id: string; name: string }[];
  note?: string;
  /** Answers extracted at once. */
  extractionConcurrency?: number;
  /** Aborts the provider calls (an aborted call is stored as a timeout). */
  signal?: AbortSignal;
  /** Aborts extractions. Defaults to `signal`; set it later to leave extraction time after a deadline. */
  extractionSignal?: AbortSignal;
  /** Called as each provider call lands, before its extraction. */
  onAnswer?: (event: AnswerEvent) => void;
  /** Test seam for the extraction client. */
  extractionClient?: ResponsesClient;
}

export type AnswerEvent =
  | { provider: ProviderId; question: string; ok: true; result: AskResult }
  | { provider: ProviderId; question: string; ok: false; error: ProviderError };

export interface RunPipelineResult {
  runId: string;
  status: RunStatus;
  answers: {
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
  const providerIds = options.providers ?? (Object.keys(PROVIDERS) as ProviderId[]);
  const questions = options.questions?.length ? options.questions : [{ text: topic }];
  const subTopicIds = Object.fromEntries((options.subTopics ?? []).map((s) => [s.name, s.id]));

  const run = await db.run.create({
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
  const models = await getModels();

  // Ask every provider every question, in parallel; store each answer (or
  // failure) with the provider's citations as it lands, then run the one
  // extraction pass over it straight away rather than waiting for the rest.
  type Stored = RunPipelineResult["answers"][number] & {
    answerText?: string;
    providerUrls: string[];
    citationCount: number;
  };
  const calls = questions.flatMap((q) => providerIds.map((provider) => ({ q, provider })));
  const stored: Stored[] = await Promise.all(
    calls.map(async ({ q, provider }): Promise<Stored> => {
      const ctx = { runId: run.id, question: q.text, questionId: q.questionId, repeat: q.repeat };
      let result: AskResult;
      try {
        result = await PROVIDERS[provider].ask(q.text, { location, signal, settings: models[provider] });
      } catch (err) {
        const error = toProviderError(provider, err);
        safely(() => options.onAnswer?.({ provider, question: q.text, ok: false, error }));
        const row = await db.answer.create({
          data: failedAnswerCreateData(ctx, models[provider], error, location ?? null),
          select: { id: true },
        });
        return {
          answerId: row.id,
          provider,
          question: q.text,
          ok: false,
          answerCostUsd: 0,
          error: `${error.kind}: ${error.message}`,
          errorKind: error.kind,
          providerUrls: [],
          citationCount: 0,
        };
      }
      safely(() => options.onAnswer?.({ provider, question: q.text, ok: true, result }));
      const citations = providerCitationRows(result.sources);
      const row = await db.answer.create({
        data: { ...answerCreateData(ctx, result), citations: { create: citations } },
        select: { id: true },
      });
      const s: Stored = {
        answerId: row.id,
        provider,
        question: q.text,
        ok: true,
        answerCostUsd: result.cost.usd,
        answerText: result.answer,
        providerUrls: citations.map((c) => c.url),
        citationCount: citations.length,
      };
      if (s.answerText) {
        s.extraction = await extractSlot(() =>
          extractAndStore(
            db,
            { id: s.answerId, answer: s.answerText!, providerUrls: s.providerUrls, nextCitationPosition: s.citationCount },
            { topic, question: s.question, subTopics: options.subTopics?.map((t) => t.name) },
            { subTopicIds, client: options.extractionClient, signal: extractionSignal }
          )
        );
      }
      return s;
    })
  );

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
