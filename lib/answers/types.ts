import type { Provider as ProviderId } from "@/lib/types";

export type { ProviderId };

/** An approximate user location, the way a consumer app would know it. */
export interface UserLocation {
  city: string;
  /** State or region, written out ("Texas"). */
  region: string;
  /** Two-letter ISO country code ("US"). */
  country: string;
  /** IANA timezone ("America/Chicago"). */
  timezone?: string;
}

/**
 * How the location reached the provider.
 * - `parameter`: the provider's own search-location parameter.
 * - `by_prompt`: no such parameter exists, so it went in a system message.
 * - `none`: no location was given.
 */
export type LocationMode = "parameter" | "by_prompt" | "none";

export interface AnswerSource {
  url: string;
  title: string | null;
  /**
   * true: cited in the answer. false: only looked at (returned by a search but
   * not cited). null: the API doesn't say which.
   */
  cited: boolean | null;
}

export interface AnswerUsage {
  /** All input tokens billed, including cached ones and search content. */
  inputTokens: number;
  /** Of inputTokens, how many were cache reads (billed at a lower rate). */
  cachedInputTokens: number;
  /** Output tokens billed, including any reasoning/thinking tokens. */
  outputTokens: number;
  /** Of outputTokens, how many were reasoning/thinking. */
  reasoningTokens: number;
  /** Billable search calls (each provider's own unit; see prices.ts). */
  searchCalls: number;
}

export interface AnswerCost {
  usd: number;
  /**
   * `provider`: the provider reported the charge (xAI's cost_in_usd_ticks).
   * `computed`: computed from usage and the price table.
   */
  source: "provider" | "computed";
  /** Parts of a computed cost. Absent when the provider reported the total. */
  breakdown?: { tokensUsd: number; searchUsd: number };
  /** Price-table rows used, so a stored cost can be traced to its prices. */
  priceIds: string[];
  /** Anything that makes the figure approximate. */
  note?: string;
}

export interface AskResult {
  provider: ProviderId;
  /** The model asked for (the provider's MODEL constant). */
  requestedModel: string;
  /** The model that answered, as the response names it. */
  model: string;
  question: string;
  answer: string;
  sources: AnswerSource[];
  /** The search queries the provider ran, in order. */
  searchQueries: string[];
  usage: AnswerUsage;
  location: UserLocation | null;
  locationMode: LocationMode;
  cost: AnswerCost;
  /** The provider's own stop/finish reason. */
  finishReason: string | null;
  latencyMs: number;
}

export interface AskOptions {
  location?: UserLocation;
  signal?: AbortSignal;
}

/** One way to ask every AI: a plain question, web search on. */
export interface AnswerProvider {
  id: ProviderId;
  model: string;
  ask(question: string, options?: AskOptions): Promise<AskResult>;
}

/**
 * Why a provider couldn't answer.
 * - `quota_exhausted`: billing or quota; won't clear by retrying.
 * - `rate_limited`: too many requests; clears on its own.
 * - `auth`: bad key or no access to the model.
 * - `blocked`: a safety filter or refusal.
 * - `unavailable`: the provider's servers (5xx, overloaded).
 * - `timeout`: aborted or timed out.
 * - `other`: anything else, including bugs.
 */
export type ProviderErrorKind =
  | "quota_exhausted"
  | "rate_limited"
  | "auth"
  | "blocked"
  | "unavailable"
  | "timeout"
  | "other";

/** Every failure from `AnswerProvider.ask` is one of these. */
export class ProviderError extends Error {
  readonly provider: ProviderId;
  readonly kind: ProviderErrorKind;
  /** HTTP status, when the failure was an HTTP error. */
  readonly status: number | null;

  constructor(
    provider: ProviderId,
    kind: ProviderErrorKind,
    message: string,
    status: number | null = null,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "ProviderError";
    this.provider = provider;
    this.kind = kind;
    this.status = status;
  }
}
