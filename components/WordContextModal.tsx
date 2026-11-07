"use client";

import { useId } from "react";
import Dialog from "@/components/Dialog";
import CloseButton from "@/components/CloseButton";
import type { WordContextMatch } from "@/lib/analysis/word-context";
import { providerColor } from "@/lib/providers";

interface Props {
  word: string;
  matches: WordContextMatch[];
  onClose: () => void;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightWord(text: string, word: string): React.ReactNode[] {
  // Build a regex that matches any individual word from the phrase
  const words = word
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map(escapeRegex);
  const pattern = words.length === 1
    ? `(\\b${words[0]}\\b)`
    : `(\\b(?:${words.join("|")})\\b)`;
  const regex = new RegExp(pattern, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <mark key={i} className="bg-cyan-100 text-(--text-primary) rounded px-0.5 font-medium">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

// Excerpts are cut from the raw answer Markdown; show them as plain text.
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)/g, "")
    .replace(/^\s*(?:[-*+]|#{1,6}|\d+\.)\s+/, "")
    .replace(/(^|\s)\*(\S[^*]*\S)\*(?=\s|$)/g, "$1$2")
    .trim();
}

export default function WordContextModal({ word, matches, onClose }: Props) {
  const headingId = useId();

  return (
    <Dialog labelledBy={headingId} onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-black/5">
          <h2 id={headingId} className="text-lg font-bold text-(--text-primary) text-pretty">
            &ldquo;{word}&rdquo; in context
          </h2>
          <CloseButton onClick={onClose} />
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 space-y-6">
          {matches.length === 0 ? (
            <p className="text-(--text-tertiary) text-sm text-center py-4">
              No context found for this word.
            </p>
          ) : (
            matches.map((match) => (
              <div key={match.provider}>
                <div className="flex items-center gap-2 mb-3">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${providerColor(match.provider)}`}
                  >
                    {match.providerLabel}
                  </span>
                </div>
                <ul className="space-y-2">
                  {match.excerpts.map((excerpt, i) => (
                    <li
                      key={i}
                      className="text-sm text-(--text-secondary) leading-relaxed pl-3 border-l-2 border-(--accent-cyan)/30 break-words"
                    >
                      {highlightWord(stripMarkdown(excerpt), word)}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </Dialog>
  );
}
