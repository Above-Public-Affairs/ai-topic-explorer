import type { AnswerSource, LocationMode, UserLocation } from "./types";

/**
 * Retry budget for a single provider request, on top of the SDK default of 2.
 * The OpenAI-compatible SDKs retry 429/5xx with exponential backoff and honor
 * the response's `retry-after`. The caller's signal aborts mid-retry, so this
 * can't extend a request past its deadline.
 */
export const REQUEST_MAX_RETRIES = 4;

/** The location the tracker asks from unless told otherwise. */
export const TEXAS_LOCATION: UserLocation = {
  city: "Austin",
  region: "Texas",
  country: "US",
  timezone: "America/Chicago",
};

/** System message for providers whose search takes no location parameter. */
export function locationSystemMessage(location: UserLocation): string {
  return `The user's approximate location is ${location.city}, ${location.region}, ${location.country}.`;
}

/**
 * How a location is sent, given the registry's location mode and whether the
 * provider's search takes a location parameter. `parameter` on a provider
 * without one falls back to the prompt; no location is always `none`.
 */
export function planLocation(
  location: UserLocation | undefined,
  mode: LocationMode,
  supportsParameter: boolean
): { mode: LocationMode; parameter: UserLocation | null; systemMessage: string | null } {
  if (!location || mode === "none") return { mode: "none", parameter: null, systemMessage: null };
  if (mode === "parameter" && supportsParameter) {
    return { mode: "parameter", parameter: location, systemMessage: null };
  }
  return { mode: "by_prompt", parameter: null, systemMessage: locationSystemMessage(location) };
}

/**
 * Merge sources by URL. A source counts as cited if any entry for it was
 * cited; a known title wins over a missing one.
 */
export function mergeSources(sources: AnswerSource[]): AnswerSource[] {
  const byUrl = new Map<string, AnswerSource>();
  for (const source of sources) {
    const existing = byUrl.get(source.url);
    if (!existing) {
      byUrl.set(source.url, { ...source });
      continue;
    }
    existing.title ??= source.title;
    if (source.cited === true) existing.cited = true;
    else if (existing.cited === null && source.cited === false) existing.cited = false;
  }
  return [...byUrl.values()];
}

/** Unique, non-empty queries in first-seen order. */
export function uniqueQueries(queries: (string | undefined | null)[]): string[] {
  return [...new Set(queries.map((q) => q?.trim()).filter((q): q is string => !!q))];
}

/** Round a dollar figure to a millionth of a cent's precision for display/storage. */
export function roundUsd(usd: number): number {
  return Math.round(usd * 1e8) / 1e8;
}
