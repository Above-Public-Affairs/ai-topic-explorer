"use client";

import type { QuotedPhrase } from "@/lib/types";

interface Props {
  phrases: QuotedPhrase[];
}

const frequencyOpacity: Record<number, string> = {
  5: "opacity-100",
  4: "opacity-95",
  3: "opacity-85",
  2: "opacity-75",
  1: "opacity-65",
};

export default function QuotedPhrases({ phrases }: Props) {
  if (phrases.length === 0) return null;

  return (
    <div className="glass-tier-2 rounded-2xl p-6">
      <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wider mb-4">
        Common Talking Points
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {phrases.map((q) => (
          <div
            key={q.phrase}
            className={`relative px-4 py-3 rounded-xl bg-blue-50/60 border border-blue-100/80 ${frequencyOpacity[q.frequency] || "opacity-85"}`}
          >
            <span aria-hidden="true" className="absolute top-1 left-2 text-blue-200 text-2xl leading-none font-serif select-none">
              &ldquo;
            </span>
            <p className="text-sm text-blue-900 font-medium pl-3">
              {q.phrase}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
