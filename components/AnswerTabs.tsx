"use client";

import { useEffect, useId, useRef, useState } from "react";
import AnswerProse from "@/components/AnswerProse";
import { PROVIDER_LABELS } from "@/lib/providers";
import { trackEvent } from "@/lib/analytics";
import type { AnswerView } from "@/lib/results/run-view";

const TONE_STYLES: Record<string, string> = {
  positive: "bg-emerald-50 text-emerald-700",
  neutral: "bg-slate-100 text-slate-600",
  mixed: "bg-amber-50 text-amber-700",
  critical: "bg-rose-50 text-rose-700",
};

const DOT_COLORS: Record<string, string> = {
  claude: "bg-orange-400",
  openai: "bg-emerald-400",
  gemini: "bg-blue-400",
  grok: "bg-red-400",
};

/** "claude-sonnet-5-5" → "Claude Sonnet 5.5"; the raw id stays in the title tooltip. */
function modelName(id: string): string {
  const parts = id.split("-");
  const out: string[] = [];
  for (const part of parts) {
    const prev = out.at(-1);
    // Join version digits: "5", "5" → "5.5"; leave dates and long numbers alone.
    if (prev && /^\d$/.test(part) && /^\d+(\.\d+)?$/.test(prev) && !prev.includes(".")) {
      out[out.length - 1] = `${prev}.${part}`;
    } else {
      out.push(/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part);
    }
  }
  return out.join(" ").replace(/^Gpt\b/, "GPT");
}

/** Answers taller than this start collapsed. */
const COLLAPSED_PX = 480;
/** Fades the last lines of a collapsed answer; a mask works on the glass background. */
const FADE = "linear-gradient(to bottom, black calc(100% - 7rem), transparent)";

function AnswerPanel({ answer }: { answer: AnswerView }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setOverflows(el.scrollHeight > COLLAPSED_PX + 80);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [answer.text]);

  if (answer.status === "failed") {
    return (
      <div className="py-10 text-center">
        <p className="text-sm font-medium text-(--text-primary)">{PROVIDER_LABELS[answer.provider]} couldn&rsquo;t answer this time</p>
        {answer.errorReason && <p className="mt-1 text-sm text-(--text-tertiary)">{answer.errorReason}</p>}
      </div>
    );
  }

  const collapsed = overflows && !expanded;
  return (
    <div>
      {/* Model, tone and framing */}
      <div className="mb-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-(--text-tertiary)" title={answer.model}>{modelName(answer.model)}</span>
        {answer.tone && (
          <span className={`rounded-full px-2 py-0.5 font-medium ${TONE_STYLES[answer.tone] ?? TONE_STYLES.neutral}`}>
            Tone: {answer.tone}
          </span>
        )}
      </div>
      {answer.framing && (
        <p className="mb-6 max-w-[68ch] border-l-2 border-(--accent-cyan)/40 pl-4 text-sm leading-6 text-(--text-secondary) text-pretty">
          <span className="font-semibold text-(--text-primary)">How it frames the topic: </span>
          {answer.framing}
        </p>
      )}

      {/* The answer as written */}
      <div
        ref={bodyRef}
        // Tabbing into the faded or clipped part opens the answer, so focus is never hidden.
        onFocusCapture={() => {
          if (collapsed) setExpanded(true);
        }}
        className="overflow-hidden"
        style={collapsed ? { maxHeight: COLLAPSED_PX, maskImage: FADE, WebkitMaskImage: FADE } : undefined}
      >
        <AnswerProse text={answer.text} sources={answer.sources} />
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => {
            if (!expanded) trackEvent("answer_expanded", { provider: answer.provider });
            setExpanded((v) => !v);
          }}
          aria-expanded={expanded}
          className="pill-interactive mt-4 min-h-10 rounded-full px-4 py-2 text-sm font-medium active:scale-[0.96]"
        >
          {expanded ? "Show less" : "Read the full answer"}
        </button>
      )}

      {/* Its sources */}
      <div className="mt-8 max-w-[68ch] border-t border-black/6 pt-5">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-(--text-secondary)">
          Sources it cited <span className="tabular-nums font-normal text-(--text-tertiary)">({answer.sources.length})</span>
        </h3>
        {answer.sources.length > 0 ? (
          <ol className="space-y-3">
            {answer.sources.map((s, i) => (
              <li key={s.url} className="flex gap-3 text-sm">
                <span className="w-5 shrink-0 pt-px text-right tabular-nums text-(--text-tertiary)" aria-hidden="true">{i + 1}</span>
                <span className="min-w-0">
                  <span className="sr-only">{i + 1}. </span>
                  <a
                    href={s.url}
                    data-source-link="answer_sources"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-(--text-primary) underline decoration-black/15 underline-offset-2 hover:text-(--accent-cyan) hover:decoration-(--accent-cyan)/40 transition-colors break-words text-pretty"
                  >
                    {s.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  <span className="block text-xs text-(--text-tertiary)">{s.domain}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-(--text-tertiary)">This answer didn&rsquo;t cite any sources.</p>
        )}
      </div>
    </div>
  );
}

export default function AnswerTabs({ answers }: { answers: AnswerView[] }) {
  const firstDone = Math.max(0, answers.findIndex((a) => a.status === "done"));
  const [active, setActive] = useState(firstDone);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const baseId = useId();

  if (answers.length === 0) return null;
  const current = answers[Math.min(active, answers.length - 1)];

  const select = (i: number) => {
    setActive(i);
    trackEvent("answer_tab_selected", { provider: answers[i].provider });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = answers.length - 1;
    const next =
      e.key === "ArrowRight" ? (active === last ? 0 : active + 1)
      : e.key === "ArrowLeft" ? (active === 0 ? last : active - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="glass-tier-2 rounded-2xl">
      <div
        role="tablist"
        aria-label="Answers by AI"
        onKeyDown={onKeyDown}
        className="flex gap-1 overflow-x-auto border-b border-black/6 p-2 [scrollbar-width:none]"
      >
        {answers.map((a, i) => {
          const selected = i === active;
          return (
            <button
              key={a.provider}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${a.provider}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(i)}
              className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-[13px] font-medium sm:flex-none sm:gap-2 sm:px-4 sm:text-sm transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
                selected
                  ? "bg-white text-(--text-primary) shadow-[0_1px_2px_rgba(0,0,0,0.06),0_0_0_1px_rgba(0,0,0,0.04)]"
                  : "text-(--text-secondary) hover:bg-black/[0.03] hover:text-(--text-primary)"
              }`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${a.status === "done" ? DOT_COLORS[a.provider] : "bg-black/15"}`}
                aria-hidden
              />
              {PROVIDER_LABELS[a.provider]}
              {a.status === "failed" && <span className="sr-only">(no answer)</span>}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel`}
        aria-labelledby={`${baseId}-tab-${current.provider}`}
        className="p-5 sm:p-7"
      >
        <AnswerPanel key={current.provider} answer={current} />
      </div>
    </div>
  );
}
