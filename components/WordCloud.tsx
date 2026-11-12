"use client";

import { useMemo } from "react";
import type { WordCloudWord } from "@/lib/types";

interface Props {
  words: WordCloudWord[];
  onWordClick?: (word: string) => void;
}

const COLORS = [
  { text: "#0891b2", bg: "rgba(8,145,178,0.10)", hover: "rgba(8,145,178,0.20)", border: "rgba(8,145,178,0.25)" },
  { text: "#7c3aed", bg: "rgba(124,58,237,0.10)", hover: "rgba(124,58,237,0.20)", border: "rgba(124,58,237,0.25)" },
  { text: "#06b6d4", bg: "rgba(6,182,212,0.10)", hover: "rgba(6,182,212,0.20)", border: "rgba(6,182,212,0.25)" },
  { text: "#6d28d9", bg: "rgba(109,40,217,0.10)", hover: "rgba(109,40,217,0.20)", border: "rgba(109,40,217,0.25)" },
  { text: "#0e7490", bg: "rgba(14,116,144,0.10)", hover: "rgba(14,116,144,0.20)", border: "rgba(14,116,144,0.25)" },
  { text: "#155e75", bg: "rgba(21,94,117,0.10)", hover: "rgba(21,94,117,0.20)", border: "rgba(21,94,117,0.25)" },
];

export default function WordCloud({ words, onWordClick }: Props) {
  const pills = useMemo(() => {
    if (words.length === 0) return [];

    const maxVal = Math.max(...words.map((w) => w.value));
    const minVal = Math.min(...words.map((w) => w.value));
    const range = maxVal - minVal || 1;

    return words.map((w, i) => {
      const normalized = (w.value - minVal) / range;
      // Map to 5 size tiers
      const tier = normalized > 0.8 ? 5 : normalized > 0.6 ? 4 : normalized > 0.4 ? 3 : normalized > 0.2 ? 2 : 1;
      const color = COLORS[i % COLORS.length];
      return { text: w.text, tier, color };
    });
  }, [words]);

  if (words.length === 0) {
    return (
      <div className="glass-tier-2 rounded-2xl p-8 text-center">
        <p className="text-(--text-tertiary)">No word frequency data available.</p>
      </div>
    );
  }

  const sizeStyles: Record<number, string> = {
    5: "text-base px-4 py-2 font-semibold",
    4: "text-sm px-3.5 py-1.5 font-semibold",
    3: "text-sm px-3 py-1.5 font-medium",
    2: "text-xs px-3 py-1 font-medium",
    1: "text-xs px-2.5 py-1 font-medium",
  };

  return (
    <div className="glass-tier-2 rounded-2xl p-6">
      <div className="flex flex-wrap gap-2.5 justify-center">
        {pills.map((pill, i) => (
          <button
            key={pill.text}
            onClick={() => onWordClick?.(pill.text)}
            className={`rounded-full cursor-pointer transition-colors duration-200 border ${sizeStyles[pill.tier]}`}
            style={{
              color: pill.color.text,
              backgroundColor: pill.color.bg,
              borderColor: pill.color.border,
              animationDelay: `${i * 0.01}s`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = pill.color.hover;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = pill.color.bg;
            }}
          >
            {pill.text}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-(--text-tertiary) text-center">
        Select any term to see it in context
      </p>
    </div>
  );
}
