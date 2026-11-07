"use client";

import { useState, useCallback, useMemo } from "react";
import WordCloud from "@/components/WordCloud";
import KeyThemes from "@/components/KeyThemes";
import QuotedPhrases from "@/components/QuotedPhrases";
import WordContextModal from "@/components/WordContextModal";
import EntityList from "@/components/EntityList";
import CitationList from "@/components/CitationList";
import ResultsShell, { type ProviderStatusItem } from "@/components/ResultsShell";
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
      trackEvent({ action: "word_cloud_click", params: { word } });
      const matches = findWordContext(word, providerTexts);
      setContextModal({ word, matches });
    },
    [providerTexts]
  );

  const handleThemeClick = useCallback(
    (theme: string) => {
      trackEvent({ action: "theme_click", params: { theme } });
      const matches = findWordContext(theme, providerTexts);
      setContextModal({ word: theme, matches });
    },
    [providerTexts]
  );

  return (
    <ResultsShell
      topic={topic}
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
            {/* Desktop topic heading (hidden on mobile since it's in the header) */}
            <div className="hidden lg:block mb-8">
              <h2 className="text-3xl font-bold text-[--text-primary]">
                {topic}
              </h2>
            </div>

            {/* Key Themes */}
            <section id="key-themes" className="mb-10 scroll-mt-20">
              <h2 className="text-xl font-bold text-[--text-primary] mb-4">
                Key Themes
              </h2>
              {keyThemes.length > 0 ? (
                <KeyThemes themes={keyThemes} onThemeClick={handleThemeClick} />
              ) : (
                <WordCloud words={wordCloudData} onWordClick={handleWordClick} />
              )}
            </section>

            {/* Entities */}
            <section id="entities" className="mb-10 scroll-mt-20">
              <h2 className="text-xl font-bold text-[--text-primary] mb-1">
                Named Entities
              </h2>
              <p className="text-sm text-[--text-tertiary] mb-4">
                People and organizations mentioned across AI responses, listed by number of mentions. Capped at 15 per category.
              </p>
              <EntityList entities={entities} />
            </section>

            {/* Citations */}
            <section id="citations" className="mb-10 scroll-mt-20">
              <h2 className="text-xl font-bold text-[--text-primary] mb-1">
                Citations
              </h2>
              <p className="text-sm text-[--text-tertiary] mb-4">
                Top 10 sources ranked by AI model agreement. Additional pages from the same domain are grouped below.
              </p>
              <CitationList citations={citations} />
            </section>

            {/* X Perspective */}
            {grokQuotedPhrases && grokQuotedPhrases.length > 0 && (
              <section id="x-perspective" className="mb-10 scroll-mt-20">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-xl font-bold text-[--text-primary]">
                    X Perspective
                  </h2>
                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-400">
                    Grok
                  </span>
                </div>
                <p className="text-sm text-[--text-tertiary] mb-4">
                  These are phrases, slogans, or talking points generated from X/Twitter.
                </p>
                <QuotedPhrases phrases={grokQuotedPhrases} />
              </section>
            )}
    </ResultsShell>
  );
}
