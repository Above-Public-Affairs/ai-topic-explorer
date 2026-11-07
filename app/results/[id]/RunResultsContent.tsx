"use client";

import { useCallback, useMemo, useState } from "react";
import AnswerTabs from "@/components/AnswerTabs";
import ArgumentColumns from "@/components/ArgumentColumns";
import CitationList from "@/components/CitationList";
import EntityGroups from "@/components/EntityGroups";
import KeyThemes from "@/components/KeyThemes";
import ResultsShell, { displayTopic, type ProviderStatusItem } from "@/components/ResultsShell";
import WordContextModal from "@/components/WordContextModal";
import { findWordContext, type WordContextMatch } from "@/lib/analysis/word-context";
import { trackEvent } from "@/lib/analytics";
import type { RunView } from "@/lib/results/run-view";

interface Props {
  view: RunView;
  analysisId: string;
  providerStatuses: ProviderStatusItem[];
  partialFailureMessage: string | null;
}

const SECTIONS = [
  { id: "key-themes", label: "Key Themes" },
  { id: "answers", label: "Answers" },
  { id: "arguments", label: "Arguments" },
  { id: "entities", label: "Entities" },
  { id: "citations", label: "Sources" },
];

function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <>
      <h2 className={`text-xl font-bold text-(--text-primary) text-balance ${description ? "mb-1" : "mb-4"}`}>{title}</h2>
      {description && <p className="mb-4 text-sm text-(--text-tertiary) text-pretty">{description}</p>}
    </>
  );
}

/** Results for an analysis run on the new pipeline: each AI's answer, then what the extraction found across them. */
export default function RunResultsContent({ view, analysisId, providerStatuses, partialFailureMessage }: Props) {
  const [contextModal, setContextModal] = useState<{ word: string; matches: WordContextMatch[] } | null>(null);
  const answerTexts = useMemo(
    () => Object.fromEntries(view.answers.filter((a) => a.status === "done").map((a) => [a.provider, a.text])),
    [view.answers]
  );
  const themes = useMemo(() => view.themes.map((t) => ({ phrase: t.label, relevance: t.relevance })), [view.themes]);

  const handleThemeClick = useCallback(
    (theme: string) => {
      trackEvent({ action: "theme_click", params: { theme } });
      setContextModal({ word: theme, matches: findWordContext(theme, answerTexts) });
    },
    [answerTexts]
  );

  return (
    <ResultsShell
      topic={view.topic}
      analysisId={analysisId}
      sections={SECTIONS}
      providerStatuses={providerStatuses}
      partialFailureMessage={partialFailureMessage}
      overlay={
        contextModal && (
          <WordContextModal word={contextModal.word} matches={contextModal.matches} onClose={() => setContextModal(null)} />
        )
      }
    >
      <div className="mb-8">
        <h1 className="text-2xl lg:text-3xl font-bold text-(--text-primary) text-balance">{displayTopic(view.topic)}</h1>
        <p className="mt-2 text-sm text-(--text-tertiary) text-pretty">
          Each AI was asked this the way a person would ask it, with its own web search on.
        </p>
      </div>

      <section id="key-themes" className="mb-12 scroll-mt-4 lg:scroll-mt-8">
        <SectionHeading title="Key Themes" description="What the answers spend their time on. Larger means more AIs raised it, at more length." />
        <KeyThemes themes={themes} onThemeClick={handleThemeClick} />
      </section>

      <section id="answers" className="mb-12 scroll-mt-4 lg:scroll-mt-8">
        <SectionHeading title="Answers" description="Each AI's full answer, as it wrote it, with the sources it cited." />
        <AnswerTabs answers={view.answers} />
      </section>

      <section id="arguments" className="mb-12 scroll-mt-4 lg:scroll-mt-8">
        <SectionHeading title="Arguments" description="The case for and against that the answers make. Most widely shared first." />
        <ArgumentColumns arguments={view.arguments} />
      </section>

      <section id="entities" className="mb-12 scroll-mt-4 lg:scroll-mt-8">
        <SectionHeading title="Named Entities" description="People, organizations, places and laws the answers name, most widely named first." />
        <EntityGroups groups={view.entities} />
      </section>

      <section id="citations" className="mb-12 scroll-mt-4 lg:scroll-mt-8">
        <SectionHeading title="Sources" description="Every source the AIs cited, the ones cited by the most AIs first." />
        <CitationList citations={view.citations} disclaimer="Sources the AIs found with their own web search and cited in their answers." />
      </section>
    </ResultsShell>
  );
}
