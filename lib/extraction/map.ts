/**
 * Pure mapping from provider results and extractions to table rows. No
 * database access here, so it can be tested without one.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import type { ModelChoice } from "@/lib/answers/registry";
import type { AnswerSource, AskResult, ProviderError } from "@/lib/answers/types";
import { cleanUrl } from "./parse";
import type { ExtractionResult } from "./schema";

/** Hostname without "www.", or null for a URL that doesn't parse. */
export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** A URL reduced to a key for de-duplication: no fragment, no trailing slash. */
function urlKey(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export type CitationRow = Omit<Prisma.CitationCreateManyInput, "answerId">;

/** The provider's own sources, in response order. Unparseable URLs are skipped. */
export function providerCitationRows(sources: AnswerSource[]): CitationRow[] {
  const rows: CitationRow[] = [];
  for (const s of sources) {
    const domain = domainOf(s.url);
    if (!domain) continue;
    rows.push({ url: s.url, domain, title: s.title, cited: s.cited, origin: "provider", position: rows.length });
  }
  return rows;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"'`)\]]+/g;

/**
 * Sources the extraction found that the provider didn't report: URLs written
 * in the answer text, plus URLs the extraction model attributed claims to.
 * Positions continue after the provider's rows.
 */
export function extractedCitationRows(
  answerText: string,
  result: Pick<ExtractionResult, "sources" | "arguments" | "entities">,
  providerUrls: string[],
  startPosition: number
): CitationRow[] {
  const seen = new Set(providerUrls.map(urlKey));
  const rows: CitationRow[] = [];
  const add = (url: string | null, title: string | null) => {
    if (!url) return;
    const domain = domainOf(url);
    const key = urlKey(url);
    if (!domain || seen.has(key)) return;
    seen.add(key);
    rows.push({ url, domain, title, cited: true, origin: "extracted", position: startPosition + rows.length });
  };
  for (const s of result.sources) add(s.url, s.name);
  for (const match of answerText.match(URL_IN_TEXT) ?? []) add(cleanUrl(match), null);
  for (const a of result.arguments) add(a.sourceUrl, null);
  return rows;
}

export interface ExtractionMeta {
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  priceIds: string[];
  raw: unknown;
}

/**
 * Extraction row with its entities, themes and arguments nested.
 * `subTopicIds` maps sub-topic names (as passed to the extraction) to ids.
 */
export function extractionCreateData(
  answerId: string,
  result: ExtractionResult,
  meta: ExtractionMeta,
  subTopicIds: Record<string, string> = {}
): Prisma.ExtractionUncheckedCreateInput {
  return {
    answerId,
    model: meta.model,
    promptVersion: meta.promptVersion,
    tone: result.tone,
    framing: result.framing,
    inputTokens: meta.inputTokens,
    outputTokens: meta.outputTokens,
    costUsd: meta.costUsd,
    priceIds: meta.priceIds,
    raw: (meta.raw ?? undefined) as Prisma.InputJsonValue | undefined,
    entities: {
      create: result.entities.map((e) => ({
        name: e.name,
        normalized: e.normalized,
        type: e.type,
        mentions: e.mentions,
        url: e.url,
      })),
    },
    themes: {
      create: result.themes.map((t) => ({
        label: t.label,
        normalized: t.normalized,
        sentiment: t.sentiment,
        weight: t.weight,
        subTopicId: (t.subTopic && subTopicIds[t.subTopic]) || null,
      })),
    },
    arguments: {
      create: result.arguments.map((a) => ({ side: a.side, text: a.text, sourceUrl: a.sourceUrl })),
    },
  };
}

export interface AnswerContext {
  runId: string;
  question: string;
  questionId?: string | null;
  repeat?: number;
}

/** Answer row for a provider result, without its citations. */
export function answerCreateData(ctx: AnswerContext, r: AskResult): Prisma.AnswerUncheckedCreateInput {
  return {
    runId: ctx.runId,
    questionId: ctx.questionId ?? null,
    question: ctx.question,
    repeat: ctx.repeat ?? 1,
    provider: r.provider,
    modelRegistryId: r.modelRegistryId,
    requestedModel: r.requestedModel,
    model: r.model,
    answer: r.answer,
    finishReason: r.finishReason,
    latencyMs: r.latencyMs,
    searchQueries: r.searchQueries,
    locationCity: r.location?.city ?? null,
    locationRegion: r.location?.region ?? null,
    locationCountry: r.location?.country ?? null,
    locationTimezone: r.location?.timezone ?? null,
    locationMode: r.locationMode,
    inputTokens: r.usage.inputTokens,
    cachedInputTokens: r.usage.cachedInputTokens,
    outputTokens: r.usage.outputTokens,
    reasoningTokens: r.usage.reasoningTokens,
    searchCalls: r.usage.searchCalls,
    costUsd: r.cost.usd,
    costSource: r.cost.source,
    costTokensUsd: r.cost.breakdown?.tokensUsd ?? null,
    costSearchUsd: r.cost.breakdown?.searchUsd ?? null,
    priceIds: r.cost.priceIds,
    costNote: r.cost.note ?? null,
  };
}

/** Answer row for a provider call that failed: no answer text, error fields set. */
export function failedAnswerCreateData(
  ctx: AnswerContext,
  choice: ModelChoice,
  error: ProviderError,
  location: AskResult["location"]
): Prisma.AnswerUncheckedCreateInput {
  return {
    runId: ctx.runId,
    questionId: ctx.questionId ?? null,
    question: ctx.question,
    repeat: ctx.repeat ?? 1,
    provider: choice.provider,
    modelRegistryId: choice.registryId,
    requestedModel: choice.model,
    locationCity: location?.city ?? null,
    locationRegion: location?.region ?? null,
    locationCountry: location?.country ?? null,
    locationTimezone: location?.timezone ?? null,
    // The call never returned; recorded as the model list says it's sent.
    locationMode: location ? choice.locationMode : "none",
    errorKind: error.kind,
    errorStatus: error.status,
    errorMessage: error.message.slice(0, 2000),
  };
}
