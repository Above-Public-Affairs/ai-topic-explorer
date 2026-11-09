"use client";

import { useState, useCallback, useMemo } from "react";
import WordCloud from "@/components/WordCloud";
import KeyThemes from "@/components/KeyThemes";
import QuotedPhrases from "@/components/QuotedPhrases";
import WordContextModal from "@/components/WordContextModal";
import EntityList from "@/components/EntityList";
import CitationList from "@/components/CitationList";
import ResultsShell, { displayTopic, type ProviderStatusItem } from "@/components/ResultsShell";
import Link from "next/link";
import { findWordContext, type WordContextMatch } from "@/lib/analysis/word-context";
import { trackEvent } from "@/lib/analytics";
import type {
  WordCloudWord,
  KeyTheme,
  QuotedPhrase,
  CombinedEntities,
  CombinedCitation,
} from "@/lib/types";

interface Props {
  topic: string;
  wordCloudData: WordCloudWord[];
  keyThemes: KeyTheme[];
  entities: CombinedEntities;
  citations: CombinedCitation[];
  providerStatuses: ProviderStatusItem[];
  partialFailureMessage: string | null;
  analysisId: string;
  providerTexts: Record<string, string>;
  grokQuotedPhrases: QuotedPhrase[] | null;
}

export default function ResultsContent({
  topic,
  wordCloudData,
  keyThemes,
  entities,
  citations,
  providerStatuses,
  partialFailureMessage,
  analysisId,
  providerTexts,
  grokQuotedPhrases,
}: Props) {
  const sections = useMemo(() => [
    { id: "key-themes", label: "Key Themes" },
    { id: "entities", label: "Entities" },
    { id: "citations", label: "Citations" },
    ...(grokQuotedPhrases ? [{ id: "x-perspective", label: "X Perspective" }] : []),
  ], [grokQuotedPhrases]);
  const [contextModal, setContextModal] = useState<{
    word: string;
    matches: WordContextMatch[];
  } | null>(null);

  const handleWordClick = useCallback(
    (word: string) => {
      trackEvent("word_clicked", { word });
      const matches = findWordContext(word, providerTexts);
      setContextModal({ word, matches });
    },
    [providerTexts]
  );

  const handleThemeClick = useCallback(
    (theme: string) => {
      trackEvent("theme_clicked", { theme });
      const matches = findWordContext(theme, providerTexts);
      setContextModal({ word: theme, matches });
    },
    [providerTexts]
  );

  return (
    <ResultsShell
      topic={topic}
      layout="old"
      analysisId={analysisId}
      sections={sections}
      providerStatuses={providerStatuses}
      partialFailureMessage={partialFailureMessage}
      overlay={
        contextModal && (
          <WordContextModal
            word={contextModal.word}
            matches={contextModal.matches}
            onClose={() => setContextModal(null)}
          />
        )
      }
    >
            <div className="mb-8">
              <h1 className="text-2xl lg:text-3xl font-bold text-(--text-primary) text-balance">
                {displayTopic(topic)}
              </h1>
              <p className="mt-2 text-sm text-(--text-secondary) text-pretty">
                Saved with an earlier version of AI Topic Explorer.{" "}
                <Link
                  href={`/?topic=${encodeURIComponent(topic)}`}
                  className="font-medium text-(--accent-cyan) underline underline-offset-2 hover:text-(--accent-violet) transition-colors"
                >
                  Run this topic again
                </Link>{" "}
                to see each AI&rsquo;s full answer and the sources it cited.
              </p>
            </div>

            {/* Key Themes */}
            <section id="key-themes" className="mb-10 scroll-mt-4 lg:scroll-mt-8">
              <h2 className="text-xl font-bold text-(--text-primary) mb-4">
                Key Themes
              </h2>
              {keyThemes.length > 0 ? (
                <KeyThemes themes={keyThemes} onThemeClick={handleThemeClick} />
              ) : (
                <WordCloud words={wordCloudData} onWordClick={handleWordClick} />
              )}
            </section>

            {/* Entities */}
            <section id="entities" className="mb-10 scroll-mt-4 lg:scroll-mt-8">
              <h2 className="text-xl font-bold text-(--text-primary) mb-1">
                Named Entities
              </h2>
              <p className="text-sm text-(--text-tertiary) mb-4">
                People and organizations mentioned across AI responses, listed by number of mentions. Capped at 15 per category.
              </p>
              <EntityList entities={entities} />
            </section>

            {/* Citations */}
            <section id="citations" className="mb-10 scroll-mt-4 lg:scroll-mt-8">
              <h2 className="text-xl font-bold text-(--text-primary) mb-1">
                Citations
              </h2>
              <p className="text-sm text-(--text-tertiary) mb-4">
                Top 10 sources ranked by AI model agreement. Additional pages from the same domain are grouped below.
              </p>
              <CitationList citations={citations} />
            </section>

            {/* X Perspective */}
            {grokQuotedPhrases && grokQuotedPhrases.length > 0 && (
              <section id="x-perspective" className="mb-10 scroll-mt-4 lg:scroll-mt-8">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-bold text-(--text-primary)">
                    X Perspective
                  </h2>
                  <span className="inline-block px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-700">
                    Grok
                  </span>
                </div>
                <p className="text-sm text-(--text-tertiary) mb-4">
                  These are phrases, slogans, or talking points generated from X/Twitter.
                </p>
                <QuotedPhrases phrases={grokQuotedPhrases} />
              </section>
            )}
    </ResultsShell>
  );
}
