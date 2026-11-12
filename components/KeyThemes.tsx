"use client";

import type { KeyTheme } from "@/lib/types";

interface Props {
  themes: KeyTheme[];
  onThemeClick?: (phrase: string) => void;
}

const sizeClasses: Record<number, string> = {
  5: "text-base px-4 py-2",
  4: "text-sm px-3.5 py-1.5",
  3: "text-sm px-3 py-1.5",
  2: "text-xs px-3 py-1.5",
  1: "text-xs px-2.5 py-1.5",
};

export default function KeyThemes({ themes, onThemeClick }: Props) {
  if (themes.length === 0) {
    return (
      <div className="glass-tier-2 rounded-2xl p-8 text-center">
        <p className="text-(--text-tertiary)">No key themes identified.</p>
      </div>
    );
  }

  return (
    <div className="glass-tier-2 rounded-2xl p-6">
      <div className="flex flex-wrap gap-2.5 justify-center overflow-hidden">
        {themes.map((theme) => (
          <button
            key={theme.phrase}
            onClick={() => onThemeClick?.(theme.phrase)}
            type="button"
            // Small pills get a 40px+ tap area without looking bigger.
            className={`hit-area [--hit-y:-5px] [--hit-x:-4px] pill-interactive rounded-[18px] font-medium cursor-pointer active:scale-[0.96] max-w-full whitespace-normal text-balance text-center ${sizeClasses[theme.relevance] || sizeClasses[3]}`}
          >
            {theme.phrase}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-(--text-tertiary) text-center">
        Select any theme to see it in context
      </p>
    </div>
  );
}
