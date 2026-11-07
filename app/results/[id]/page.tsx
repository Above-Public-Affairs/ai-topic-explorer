import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { toWordCloudData, topicToWords } from "@/lib/analysis/word-frequency";
import { reportError } from "@above-public-affairs/error-reporter";
import type { KeyTheme, Provider } from "@/lib/types";
import { PROVIDER_LABELS } from "@/lib/providers";
import { readStoredResult } from "@/lib/results/stored-result";
import ResultsContent from "./ResultsContent";
import UnreadableResult from "./UnreadableResult";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ResultsPage({ params }: Props) {
  const { id } = await params;

  const analysis = await prisma.analysis.findUnique({
    where: { id },
  });

  if (!analysis) {
    notFound();
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
