"use client";

import { useState, useCallback, useMemo } from "react";
import Link from "next/link";
import WordCloud from "@/components/WordCloud";
import KeyThemes from "@/components/KeyThemes";
import QuotedPhrases from "@/components/QuotedPhrases";
import WordContextModal from "@/components/WordContextModal";
import EntityList from "@/components/EntityList";
import CitationList from "@/components/CitationList";
import ProgressTracker from "@/components/ProgressTracker";
import Footer from "@/components/Footer";
import { findWordContext, type WordContextMatch } from "@/lib/analysis/word-context";
import { trackEvent } from "@/lib/analytics";
import type {
  WordCloudWord,
  KeyTheme,
  QuotedPhrase,
  CombinedEntities,
  CombinedCitation,
  Provider,
} from "@/lib/types";

interface Props {
  topic: string;
  wordCloudData: WordCloudWord[];
  keyThemes: KeyTheme[];
  entities: CombinedEntities;
  citations: CombinedCitation[];
  providerStatuses: { provider: Provider; status: "done" | "failed" | "unavailable"; errorReason?: string }[];
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
  const [copied, setCopied] = useState(false);
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

  const handleShare = async () => {
    trackEvent({ action: "share_clicked" });
    const url = `${window.location.origin}/results/${analysisId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Mobile header (visible below lg) ── */}
      <div className="lg:hidden sticky top-0 z-40 bg-[--bg-base]/80 backdrop-blur-xl border-b border-black/6">
        <div className="px-4 py-3">
          {/* Topic + actions */}
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-lg font-bold text-[--text-primary] truncate mr-3">
              {topic}
            </h1>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleShare}
                className="pill-interactive px-3 py-1.5 rounded-full text-xs font-medium"
              >
                {copied ? "Copied!" : "Share"}
              </button>
              <Link
                href="/"
                onClick={() => trackEvent({ action: "new_topic_from_results" })}
                className="btn-primary px-3 py-1.5 rounded-full text-xs"
              >
                New Topic
              </Link>
            </div>
          </div>

          {/* Provider status */}
          <ProgressTracker providers={providerStatuses} layout="horizontal" />

          {/* Section jump links */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="text-[--text-tertiary] hover:text-[--accent-cyan] transition-colors"
              >
                {s.label}
              </a>
            ))}
          </div>

          {/* Partial failure banner */}
          {partialFailureMessage && (
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
              {partialFailureMessage}
            </div>
          )}
        </div>
      </div>

      {/* ── Desktop layout ── */}
      <div className="flex-1 flex">
        {/* Sidebar (visible at lg+) */}
        <aside className="hidden lg:flex flex-col w-[272px] shrink-0 sidebar-sticky bg-white/30 backdrop-blur-sm border-r border-black/6 px-6 py-8">
          {/* Topic */}
          <h1 className="text-xl font-bold text-[--text-primary] mb-1">
            {topic}
          </h1>
          <p className="text-xs text-[--text-tertiary] mb-6">AI Topic Analysis</p>

          {/* Sources */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-[--text-secondary] uppercase tracking-wider mb-3">
              Sources
            </p>
            <ProgressTracker providers={providerStatuses} layout="vertical" />
          </div>

          {/* Partial failure */}
          {partialFailureMessage && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
              {partialFailureMessage}
            </div>
          )}

          {/* Section nav */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-[--text-secondary] uppercase tracking-wider mb-3">
              Sections
            </p>
            <nav className="flex flex-col gap-1">
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="sidebar-nav-link text-sm text-[--text-secondary] hover:text-[--accent-cyan] py-1.5"
                >
                  {s.label}
                </a>
              ))}
            </nav>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Actions */}
          <div className="flex flex-col gap-2 mb-4">
            <button
              onClick={handleShare}
              className="pill-interactive w-full px-4 py-2.5 rounded-xl text-sm font-medium text-center"
            >
              {copied ? "Link copied!" : "Share results"}
            </button>
            <Link
              href="/"
              onClick={() => trackEvent({ action: "new_topic_from_results" })}
              className="btn-primary w-full px-4 py-2.5 rounded-xl text-sm text-center"
            >
              New Topic
            </Link>
          </div>

          <Footer hideChangelog />
        </aside>

        {/* Main content */}
        <div className="flex-1 py-8 px-4 sm:px-8 lg:px-12 min-w-0 overflow-hidden break-words">
          <div className="max-w-4xl mx-auto">
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
          </div>
        </div>
      </div>

      {/* Mobile footer */}
      <div className="lg:hidden border-t border-black/6 px-4 py-4">
        <Footer hideChangelog />
      </div>

      {contextModal && (
        <WordContextModal
          word={contextModal.word}
          matches={contextModal.matches}
          onClose={() => setContextModal(null)}
        />
      )}
    </div>
  );
}
