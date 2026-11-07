"use client";

import { useState } from "react";
import { PROVIDER_COLORS, PROVIDER_LABELS } from "@/lib/providers";
import type { ArgumentView } from "@/lib/results/run-view";

const INITIAL = 6;

function ProviderBadges({ providers }: { providers: ArgumentView["providers"] }) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {providers.map((p) => (
        <span key={p} className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${PROVIDER_COLORS[p]}`}>
          {PROVIDER_LABELS[p]}
        </span>
      ))}
    </span>
  );
}

function Column({ title, hint, items, accent }: { title: string; hint: string; items: ArgumentView[]; accent: string }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, INITIAL);
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-baseline gap-2">
        <span className={`h-2 w-2 shrink-0 translate-y-[-1px] rounded-full ${accent}`} aria-hidden />
        <h3 className="font-semibold text-(--text-primary)">{title}</h3>
        <span className="text-xs tabular-nums text-(--text-tertiary)">{items.length}</span>
      </div>
      <p className="mb-4 text-xs text-(--text-tertiary)">{hint}</p>
      {items.length > 0 ? (
        <ul className="space-y-3">
          {shown.map((a) => (
            <li key={a.text} className="text-sm leading-6 text-(--text-secondary)">
              <span className="text-pretty">{a.text}</span>{" "}
              <ProviderBadges providers={a.providers} />
              {a.sourceUrl && (
                <a
                  href={a.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-1.5 text-xs text-(--text-tertiary) underline decoration-black/15 underline-offset-2 hover:text-(--accent-cyan)"
                >
                  source
                </a>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm italic text-(--text-tertiary)">None given</p>
      )}
      {items.length > INITIAL && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-2 inline-flex min-h-10 items-center text-sm font-medium text-(--accent-cyan) hover:text-(--text-primary) transition-[color,scale] duration-150 active:scale-[0.96]"
        >
          {showAll ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

export default function ArgumentColumns({ arguments: args }: { arguments: { for: ArgumentView[]; against: ArgumentView[] } }) {
  if (args.for.length === 0 && args.against.length === 0) {
    return (
      <div className="glass-tier-2 rounded-2xl p-8 text-center">
        <p className="text-(--text-tertiary)">No arguments identified.</p>
      </div>
    );
  }
  return (
    <div className="glass-tier-2 rounded-2xl p-5 sm:p-6">
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <Column title="For" hint="Benefits, defenses and reassurance" items={args.for} accent="bg-emerald-500" />
        <Column title="Against" hint="Harms, costs and risks" items={args.against} accent="bg-rose-500" />
      </div>
    </div>
  );
}
