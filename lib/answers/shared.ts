import type { AnswerSource, UserLocation } from "./types";

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
