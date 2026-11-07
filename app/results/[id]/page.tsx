import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { toWordCloudData, topicToWords } from "@/lib/analysis/word-frequency";
import { reportError } from "@above-public-affairs/error-reporter";
import type { KeyTheme, Provider } from "@/lib/types";
import { PROVIDER_LABELS } from "@/lib/providers";
import { readRunPointer, readStoredResult } from "@/lib/results/stored-result";
import { loadRunView, type RunView } from "@/lib/results/run-view";
import type { ProviderStatusItem } from "@/components/ResultsShell";
import UnreadableResult from "./UnreadableResult";
import { ResultsContent, RunResultsContent } from "./layouts";

interface Props {
  params: Promise<{ id: string }>;
}

// Shared by the page and its metadata, so the row is read once per request.
const findAnalysis = cache((id: string) => prisma.analysis.findUnique({ where: { id } }));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const analysis = await findAnalysis(id);
  if (!analysis) return {};
  const topic = analysis.topic.charAt(0).toUpperCase() + analysis.topic.slice(1);
  return { title: topic, openGraph: { title: `${topic} – AI Topic Explorer` } };
}

export default async function ResultsPage({ params }: Props) {
  const { id } = await params;

  const analysis = await findAnalysis(id);

  if (!analysis) {
    notFound();
  }

  // Results from the new pipeline (v3) point to their run.
  const pointer = readRunPointer(analysis.result);
  if (pointer) {
    const view = await loadRunView(pointer.runId);
    if (!view || !view.answers.some((a) => a.status === "done")) {
      reportError({
        project: "ai-topic-explorer",
        category: "stored_result_unreadable",
        level: "warning",
        message: `Saved result can't be shown (${view ? "no answers" : "run missing"})`,
        context: { analysisId: id, runId: pointer.runId },
      });
      return <UnreadableResult topic={analysis.topic} />;
    }
    return <RunResults view={view} analysisId={id} />;
  }

  // Saved results span every version of the app, so read them through a
  // schema that fills defaults rather than trusting the stored JSON.
  const read = readStoredResult(analysis.result);
  if (!read.ok) {
    reportError({
      project: "ai-topic-explorer",
      category: "stored_result_unreadable",
      level: "warning",
      message: `Saved result can't be shown (${read.reason})`,
      context: { analysisId: id },
    });
    return <UnreadableResult topic={analysis.topic} />;
  }
  const result = read.result;

  const topicWords = topicToWords(result.topic);
  const filteredFrequencies = result.combinedWordFrequencies.filter(
    (f) => !topicWords.has(f.word)
  );
  const wordCloudData = toWordCloudData(filteredFrequencies);
  const keyThemes: KeyTheme[] = result.combinedKeyThemes;

  // Determine which providers succeeded/failed/unavailable. Results saved
  // before Nov 2026 also hold a Perplexity response; it isn't listed here.
  const allProviders: Provider[] = ["claude", "openai", "gemini", "grok"];
  const providerStatuses: { provider: Provider; status: "done" | "failed" | "unavailable"; errorReason?: string }[] =
    allProviders.map((provider) => {
      if (result.responses[provider]) {
        return { provider, status: "done" };
      } else if (result.errors[provider]) {
        return { provider, status: "failed", errorReason: result.errors[provider] };
      }
      return { provider, status: "unavailable" };
    });

  // Build partial failure message
  const failedProviders = providerStatuses
    .filter((p) => p.status === "failed")
    .map((p) => p.provider);
  const succeededProviders = providerStatuses
    .filter((p) => p.status === "done")
    .map((p) => p.provider);


  let partialFailureMessage: string | null = null;
  if (failedProviders.length > 0 && succeededProviders.length > 0) {
    const failedDetails = failedProviders
      .map((p) => {
        const reason = result.errors[p];
        return reason
          ? `${PROVIDER_LABELS[p]} (${reason})`
          : PROVIDER_LABELS[p];
      })
      .join(", ");
    const succeededNames = succeededProviders
      .map((p) => PROVIDER_LABELS[p])
      .join(" and ");
    partialFailureMessage = `${failedDetails} unavailable — showing results from ${succeededNames}`;
  }

  // Build provider raw text map for word context lookups. Grok is kept out:
  // its X/Twitter perspective is shown separately from the combined analysis.
  const providerTexts: Record<string, string> = {};
  for (const provider of allProviders) {
    if (provider === "grok") continue;
    const resp = result.responses[provider];
    if (resp) {
      providerTexts[provider] = resp.rawText;
    }
  }

  // Grok-specific analysis (separate from combined — X/Twitter data perspective)
  const grokResponse = result.responses.grok;
  const grokQuotedPhrases = grokResponse?.quotedPhrases?.length
    ? grokResponse.quotedPhrases
    : null;

  return (
    <ResultsContent
      topic={result.topic}
      wordCloudData={wordCloudData}
      keyThemes={keyThemes}
      entities={result.combinedEntities}
      citations={result.combinedCitations}
      providerStatuses={providerStatuses}
      partialFailureMessage={partialFailureMessage}
      analysisId={id}
      providerTexts={providerTexts}
      grokQuotedPhrases={grokQuotedPhrases}
    />
  );
}

function RunResults({ view, analysisId }: { view: RunView; analysisId: string }) {
  const statuses: ProviderStatusItem[] = view.answers.map((a) => ({
    provider: a.provider,
    status: a.status,
    errorReason: a.errorReason,
  }));
  const failed = view.answers.filter((a) => a.status === "failed");
  const done = view.answers.filter((a) => a.status === "done");
  const partialFailureMessage =
    failed.length > 0
      ? `${failed
          .map((a) => (a.errorReason ? `${PROVIDER_LABELS[a.provider]} (${a.errorReason})` : PROVIDER_LABELS[a.provider]))
          .join(", ")} unavailable — showing results from ${done.map((a) => PROVIDER_LABELS[a.provider]).join(" and ")}`
      : null;
  return (
    <RunResultsContent
      view={view}
      analysisId={analysisId}
      providerStatuses={statuses}
      partialFailureMessage={partialFailureMessage}
    />
  );
}
