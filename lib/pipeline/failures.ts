/**
 * Why a run came out partial, for the error report: which AI's calls failed,
 * how many, and the provider's own reason. A bare "finished partial" told Josh
 * nothing, and because the Error Reporter groups by message it filed an
 * OpenAI credit outage (Nov 10, 2026) and a Grok outage (Nov 21) as one error.
 * The headline names the AI and the error kind, so different causes group
 * apart; the Error Reporter folds the counts away.
 */
import type { ProviderId } from "@/lib/answers";
import { providerLabel } from "@/lib/providers";
import type { RunPipelineResult } from "./run";

export interface ProviderFailures {
  provider: ProviderId;
  failed: number;
  of: number;
  /** Failures per error kind ("quota_exhausted", "rate_limited", …; "not_stored" when the answer couldn't be saved). */
  kinds: Record<string, number>;
  /** The first failure's message, trimmed: the provider's own words. */
  sample: string;
}

export interface FailureSummary {
  providers: ProviderFailures[];
  /** Answers that came back but couldn't be extracted. */
  extractionFailed: number;
  extractionSample?: string;
  /** "Grok 32 of 32 calls failed (quota_exhausted); 2 extractions failed", or "" when nothing failed. */
  headline: string;
}

const SAMPLE_CHARS = 300;

export function summarizeFailures(answers: RunPipelineResult["answers"]): FailureSummary {
  const byProvider = new Map<ProviderId, ProviderFailures>();
  let extractionFailed = 0;
  let extractionSample: string | undefined;
  for (const a of answers) {
    const p = byProvider.get(a.provider) ?? { provider: a.provider, failed: 0, of: 0, kinds: {}, sample: "" };
    byProvider.set(a.provider, p);
    p.of++;
    if (!a.ok) {
      p.failed++;
      const kind = a.errorKind ?? "not_stored";
      p.kinds[kind] = (p.kinds[kind] ?? 0) + 1;
      p.sample ||= (a.error ?? "").slice(0, SAMPLE_CHARS);
    } else if (a.extraction && !a.extraction.ok) {
      extractionFailed++;
      extractionSample ??= (a.extraction.error ?? "").slice(0, SAMPLE_CHARS);
    }
  }
  const providers = [...byProvider.values()].filter((p) => p.failed > 0).sort((a, b) => b.failed - a.failed);
  const parts = providers.map((p) => {
    const kinds = Object.entries(p.kinds)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k)
      .join(", ");
    return `${providerLabel(p.provider)} ${p.failed} of ${p.of} calls failed (${kinds})`;
  });
  if (extractionFailed) parts.push(`${extractionFailed} extraction${extractionFailed === 1 ? "" : "s"} failed`);
  return { providers, extractionFailed, ...(extractionSample !== undefined ? { extractionSample } : {}), headline: parts.join("; ") };
}
