"use client";

import { useState } from "react";
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
  sections: { id: string; label: string }[];
  providerStatuses: ProviderStatusItem[];
  partialFailureMessage: string | null;
  /** Rendered after the page, e.g. a modal. */
  overlay?: React.ReactNode;
  children: React.ReactNode;
}

/** The results page frame: sticky header on mobile, sidebar on desktop, share and new-topic actions. */
export default function ResultsShell({
  topic,
  subtitle = "AI Topic Analysis",
  analysisId,
  sections,
  providerStatuses,
  partialFailureMessage,
  overlay,
  children,
}: Props) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    trackEvent({ action: "share_clicked" });
    const url = `${window.location.origin}/results/${analysisId}`;
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
          <p className="text-xs text-[--text-tertiary] mb-6">{subtitle}</p>

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
            {children}
          </div>
        </div>
      </div>

      {/* Mobile footer */}
      <div className="lg:hidden border-t border-black/6 px-4 py-4">
        <Footer hideChangelog />
      </div>

      {overlay}
    </div>
  );
}
