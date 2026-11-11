/**
 * Costs counted when the real one isn't known (task 6.6, security review L1).
 * Every spending cap reads these, so they err high: a cap that stops a little
 * early is better than one that drifts low.
 */
import type { ProviderErrorKind } from "./types";

/**
 * A provider call that failed after it was sent may still have been billed for
 * what it generated: a deadline cut it off, a refusal came back after the
 * answer, the provider fell over mid-stream. Counted at roughly a long Claude
 * answer with searches.
 */
export const FAILED_CALL_ESTIMATE_USD = 0.15;

/** Failures the provider rejects before generating anything, so nothing is billed. */
const UNBILLED_KINDS: ReadonlySet<ProviderErrorKind> = new Set(["auth", "quota_exhausted", "rate_limited"]);

/**
 * What to count for a failed provider call. Zero when the call was never sent
 * (a run stopped at its cap skips the calls still queued) or the provider
 * refused it up front.
 */
export function failedCallEstimateUsd(kind: ProviderErrorKind, sent: boolean): number {
  if (!sent || UNBILLED_KINDS.has(kind)) return 0;
  return FAILED_CALL_ESTIMATE_USD;
}

/**
 * An extraction that failed (a deadline, a bad response) was usually billed.
 * Extractions cost about $0.0007 each (PROJECT-PLAN "Measured cost"), so this
 * is several times that.
 */
export const FAILED_EXTRACTION_ESTIMATE_USD = 0.005;

/**
 * Searches one answer may run. Claude averages 0.8, OpenAI 2.6 and up to 5
 * (PROJECT-PLAN "Measured cost"), so this only stops a topic written to make
 * the model search over and over.
 */
export const MAX_SEARCHES_PER_ANSWER = 6;
