"use client";

import { useState, useRef, useEffect } from "react";

const CHANGELOG: { date: string; changes: string[] }[] = [
  {
    date: "Oct 28",
    changes: [
      "Gemini retries when Google is busy and falls back to a lighter model, so it drops out of comparisons less often",
      "Claude's analysis now uses Claude Sonnet 5.5, and Gemini's uses Gemini 3.5 Flash",
      "Fewer cut-off responses, so named entities, citations and themes come through more reliably",
      "Keep stray formatting out of the word cloud when a response is cut off",
      "Clearer reasons when an AI provider is unavailable, such as a blocked API key or an exhausted quota",
    ],
  },
  {
    date: "Aug 20",
    changes: [
      "Fix a bug where one malformed field in an AI's response threw away that provider's entire analysis",
      "Cancel timed-out provider requests properly and retry rate-limited ones, so fewer providers drop out of a comparison",
    ],
  },
  {
    date: "Aug 6",
    changes: [
      "Keep partial Claude results when a response is cut short instead of dropping the whole query",
      "Give each provider query more time to finish so healthy requests aren't cancelled mid-answer",
    ],
  },
  {
    date: "Jul 22",
    changes: [
      "Stream Claude responses and cancel timed-out requests to cut down on provider timeouts",
    ],
  },
  {
    date: "Mar 12",
    changes: [
      "Fix Claude timeouts by increasing provider timeout to 90s and reducing max response length",
      "Add timeout to query expansion to prevent indefinite hangs",
    ],
  },
  {
    date: "Mar 10",
    changes: [
      "Add beta announcement banner at the top of every page",
      "Add floating 'Report a Bug' button with submission form",
    ],
  },
  {
    date: "Feb 15",
    changes: [
      "Show specific error reasons when an AI provider fails (timeout, rate limit, API error, etc.)",
      "Fix text overflow issues on small screens for entities, citations, and word context",
      "Add error reporting for daily error reports",
    ],
  },
  {
    date: "Feb 14",
    changes: [
      "Upgrade Gemini from deprecated 2.0 Flash to 2.5 Flash to fix failures",
      "Update metadata, OG image, and Apple icon to reflect all 5 AI platforms",
      "Disable Gemini safety filters so sensitive topics aren't blocked",
      "Increase provider timeout to 60s so Claude has enough time to respond",
      "Change Grok pill to red to match X/Twitter branding",
      "Add stability improvements: DB save retry, client-side timeout, abort on disconnect, data validation",
      "Fix analysis timeout by switching Gemini to faster model and adding per-provider timeouts",
      "Hide changelog link on results page to reduce sidebar clutter",
      "Replace Web Perspective with lightweight Perplexity section showing related questions",
      "Show top 10 citations with same-domain companions, compact single-line layout",
      "Cap named entities at 15 per category, sorted by number of mentions",
      "Show provider pills next to each named entity showing which AI mentioned it",
      "Rename X section to 'X Perspective' with Grok pill, clarify phrases are AI-generated",
      "Cut X Perspective phrases from 15 to 8 with longer talking points",
      "Add explainer subtitles to Citations and Related Questions sections",
      "Add Grok (xAI) as 5th AI provider with separate X / Social Perspective section",
      "Add changelog modal to footer",
      "Add GA4 analytics, event tracking, and increase max AI response length",
      "Add OpenAI, Gemini, and Perplexity providers for multi-AI comparison",
    ],
  },
  {
    date: "Feb 13",
    changes: [
      "Fix mobile overflow on Key Themes, Citations, and main content area",
      "Add OG/Twitter metadata, expand floating keywords, and improve UI polish",
    ],
  },
];

export default function Footer({ hideChangelog = false }: { hideChangelog?: boolean } = {}) {
  const [showChangelog, setShowChangelog] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showChangelog) return;
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setShowChangelog(false);
    }
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showChangelog]);

  return (
    <>
      <footer className="py-8 px-8 border-t border-black/5 text-center">
        <p className="text-xs text-[--text-tertiary]">
          Built by{" "}
          <a
            href="https://www.linkedin.com/in/joshuacanter/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium hover:text-[--accent-cyan] transition-colors"
          >
            The Canter Company
          </a>
          {!hideChangelog && (
            <>
              <span className="mx-1.5">&middot;</span>
              <button
                onClick={() => setShowChangelog(true)}
                className="hover:text-[--accent-cyan] transition-colors underline underline-offset-2"
              >
                Changelog
              </button>
            </>
          )}
        </p>
      </footer>

      {showChangelog && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={(e) => {
            if (e.target === overlayRef.current) setShowChangelog(false);
          }}
        >
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />
          <div
            className="relative glass-tier-3 max-w-md w-full max-h-[80vh] overflow-y-auto p-6 sm:p-8 rounded-2xl shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowChangelog(false)}
              className="absolute top-4 right-4 text-[--text-tertiary] hover:text-[--text-primary] transition-colors text-xl leading-none"
              aria-label="Close"
            >
              &times;
            </button>

            <h2 className="text-xl font-bold text-[--text-primary] mb-5">
              Changelog
            </h2>

            <div className="space-y-5">
              {CHANGELOG.slice(0, 5).map((day, i) => (
                <div key={i}>
                  <p className="text-xs font-semibold text-[--accent-cyan] mb-1.5">
                    {day.date}
                  </p>
                  <ul className="space-y-1 pl-3">
                    {day.changes.map((change, j) => (
                      <li
                        key={j}
                        className="text-sm text-[--text-secondary] leading-relaxed list-disc"
                      >
                        {change}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
