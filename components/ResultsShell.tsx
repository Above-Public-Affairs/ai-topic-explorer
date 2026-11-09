"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ProgressTracker from "@/components/ProgressTracker";
import Footer from "@/components/Footer";
import { trackEvent } from "@/lib/analytics";
import type { Provider } from "@/lib/types";

export interface ProviderStatusItem {
  provider: Provider;
  status: "done" | "failed" | "unavailable";
  errorReason?: string;
}

interface Props {
  topic: string;
  subtitle?: string;
  analysisId: string;
  /** Which results layout this is, for analytics: "new" pipeline runs or "old" saved results. */
  layout: "new" | "old";
  sections: { id: string; label: string }[];
  providerStatuses: ProviderStatusItem[];
  partialFailureMessage: string | null;
  /** Rendered after the page, e.g. a modal. */
  overlay?: React.ReactNode;
  children: React.ReactNode;
}

/** The `ref` value on links copied with the share button. */
const SHARE_REF = "share";

/** Topics are stored as typed; show them with a capital first letter. */
export function displayTopic(topic: string): string {
  return topic.charAt(0).toUpperCase() + topic.slice(1);
}

/** The results page frame: sticky header on mobile, sidebar on desktop, share and new-topic actions. */
export default function ResultsShell({
  topic,
  subtitle = "AI Topic Analysis",
  analysisId,
  layout,
  sections,
  providerStatuses,
  partialFailureMessage,
  overlay,
  children,
}: Props) {
  const [copied, setCopied] = useState(false);

  const aisAnswered = providerStatuses.filter((p) => p.status === "done").length;
  useEffect(() => {
    const fromShare = new URLSearchParams(window.location.search).get("ref") === SHARE_REF;
    trackEvent("results_viewed", { layout, ais_answered: aisAnswered, from_share: fromShare });
    if (fromShare) trackEvent("shared_link_opened", { item_id: analysisId });
  }, [analysisId, layout, aisAnswered]);

  const handleShare = async (placement: "header" | "sidebar") => {
    trackEvent("share", { method: "copy_link", content_type: "results", item_id: analysisId, placement });
    // Tagged so a visit from a shared link can be told apart in analytics.
    const url = `${window.location.origin}/results/${analysisId}?ref=${SHARE_REF}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const input = document.createElement("input");
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Mobile header (visible below lg) ── */}
      <header className="results-mobile-header lg:hidden sticky top-0 z-40 bg-(--bg-base)/85 backdrop-blur-xl border-b border-black/6">
        <div className="px-4 py-3">
          {/* Topic + actions */}
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-base font-bold text-(--text-primary) truncate min-w-0">
              {displayTopic(topic)}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => handleShare("header")}
                className="pill-interactive px-3.5 py-2 rounded-full text-xs font-medium active:scale-[0.96]"
              >
                {copied ? "Copied" : "Share"}
              </button>
              <Link
                href="/"
                onClick={() => trackEvent("new_topic_clicked", { placement: "header" })}
                className="btn-primary px-3.5 py-2 rounded-full text-xs active:scale-[0.96]"
              >
                New Topic
              </Link>
            </div>
          </div>

          {/* Provider status */}
          <ProgressTracker providers={providerStatuses} layout="horizontal" />

          {/* Section jump links */}
          <nav aria-label="Sections" className="flex flex-wrap gap-x-4 mt-1 -mb-1 text-xs">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="py-2 text-(--text-secondary) hover:text-(--accent-cyan) transition-colors"
              >
                {s.label}
              </a>
            ))}
          </nav>

          {/* Partial failure banner */}
          {partialFailureMessage && (
            <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-700">
              {partialFailureMessage}
            </div>
          )}
        </div>
      </header>

      {/* ── Desktop layout ── */}
      <div className="flex-1 flex">
        {/* Sidebar (visible at lg+) */}
        <aside className="hidden lg:flex flex-col w-[272px] shrink-0 sidebar-sticky bg-white/30 backdrop-blur-sm border-r border-black/6 px-6 py-8">
          {/* Topic */}
          <p className="text-xl font-bold text-(--text-primary) text-balance mb-1">
            {displayTopic(topic)}
          </p>
          <p className="text-xs text-(--text-tertiary) mb-6">{subtitle}</p>

          {/* Sources */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-3">
              AIs
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
            <p className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-3">
              Sections
            </p>
            <nav aria-label="Sections" className="flex flex-col gap-1">
              {sections.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="sidebar-nav-link text-sm text-(--text-secondary) hover:text-(--accent-cyan) py-1.5"
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
              type="button"
              onClick={() => handleShare("sidebar")}
              className="pill-interactive w-full px-4 py-2.5 rounded-xl text-sm font-medium text-center active:scale-[0.96]"
            >
              {copied ? "Link copied!" : "Share results"}
            </button>
            <Link
              href="/"
              onClick={() => trackEvent("new_topic_clicked", { placement: "sidebar" })}
              className="btn-primary w-full px-4 py-2.5 rounded-xl text-sm text-center active:scale-[0.96]"
            >
              New Topic
            </Link>
          </div>

          <Footer hideChangelog />
        </aside>

        {/* Main content. Extra bottom room on mobile so the floating bug button never covers the last line. */}
        <main id="content" tabIndex={-1} className="flex-1 pt-6 pb-24 lg:py-8 px-4 sm:px-8 lg:px-12 min-w-0 overflow-hidden break-words outline-none">
          <div className="max-w-4xl mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile footer */}
      <div className="lg:hidden border-t border-black/6 px-4 py-4">
        <Footer hideChangelog />
      </div>

      <span role="status" className="sr-only">{copied ? "Link copied" : ""}</span>

      {overlay}
    </div>
  );
}
