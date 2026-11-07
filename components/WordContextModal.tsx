"use client";

import { useEffect, useRef } from "react";
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
      <mark key={i} className="bg-[--accent-cyan-muted] text-[--accent-cyan] rounded px-0.5 font-medium">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export default function WordContextModal({ word, matches, onClose }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div className="glass-tier-3 rounded-2xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/5">
          <h3 className="text-lg font-bold text-[--text-primary]">
            &ldquo;{word}&rdquo; in context
          </h3>
          <button
            onClick={onClose}
            className="text-[--text-tertiary] hover:text-[--text-primary] transition-colors text-2xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-4 space-y-6">
          {matches.length === 0 ? (
            <p className="text-[--text-tertiary] text-sm text-center py-4">
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
                      className="text-sm text-[--text-secondary] leading-relaxed pl-3 border-l-2 border-[--accent-cyan]/30 break-words"
                    >
                      {highlightWord(excerpt, word)}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
