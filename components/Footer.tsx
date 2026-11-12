"use client";

import { useId, useState } from "react";
import Dialog from "@/components/Dialog";
import CloseButton from "@/components/CloseButton";
import { trackEvent } from "@/lib/analytics";
import type { ChangelogDay } from "@/lib/changelog";
import { PRIVACY_POLICY_URL } from "@/lib/privacy";

/**
 * Site footer. "page" sits under the page content; "sidebar" is the results
 * page's desktop sidebar, too narrow for one line, so each group gets its own.
 */
export default function Footer({ variant = "page" }: { variant?: "page" | "sidebar" } = {}) {
  // Loaded on first open, so the changelog isn't part of every page's JavaScript.
  const [entries, setEntries] = useState<ChangelogDay[] | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const headingId = useId();
  const close = () => setShowChangelog(false);
  const open = () => {
    trackEvent("modal_opened", { modal: "changelog" });
    if (entries) return setShowChangelog(true);
    import("@/lib/changelog")
      .then((m) => {
        setEntries(m.CHANGELOG.slice(0, 5));
        setShowChangelog(true);
      })
      .catch((err) => console.error("[Footer] Changelog failed to load:", err));
  };
  const sidebar = variant === "sidebar";

  return (
    <>
      {/* Two groups: on a phone (and in the sidebar) they stack, so a separator never dangles at a line end. */}
      <footer className={sidebar ? "border-t border-black/5 pt-2" : "py-6 px-8 border-t border-black/5 text-center"}>
        <div
          className={`flex flex-col text-xs text-(--text-tertiary) ${
            sidebar ? "items-start" : "sm:flex-row sm:justify-center items-center"
          }`}
        >
          <p>
            Built by{" "}
            <a
              href="https://abovepublicaffairs.com"
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-block font-medium hover:text-(--accent-cyan) transition-colors ${sidebar ? "py-2.5" : "py-3"}`}
            >
              Above Public Affairs
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
          {!sidebar && <span className="hidden sm:inline mx-1.5" aria-hidden="true">&middot;</span>}
          <p>
            <a
              href={PRIVACY_POLICY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-block hover:text-(--accent-cyan) transition-colors underline underline-offset-2 ${sidebar ? "py-2.5" : "py-3"}`}
            >
              Privacy policy
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
            <span className="mx-1.5" aria-hidden="true">&middot;</span>
            <button
              type="button"
              onClick={open}
              className={`hover:text-(--accent-cyan) transition-colors underline underline-offset-2 ${sidebar ? "py-2.5" : "py-3"}`}
            >
              Changelog
            </button>
          </p>
        </div>
      </footer>

      {showChangelog && entries && (
        <Dialog labelledBy={headingId} onClose={close} className="max-w-md">
          <div className="p-6 sm:p-8 overflow-y-auto max-h-[80vh]">
            <div className="flex items-start justify-between gap-4 mb-5">
              <h2 id={headingId} className="text-xl font-bold text-(--text-primary)">
                Changelog
              </h2>
              <CloseButton onClick={close} className="-mt-2" />
            </div>

            <div className="space-y-5">
              {entries.map((day, i) => (
                <div key={i}>
                  <p className="text-xs font-semibold text-(--accent-cyan) mb-1.5">
                    {day.date}
                  </p>
                  <ul className="space-y-1 pl-3">
                    {day.changes.map((change, j) => (
                      <li
                        key={j}
                        className="text-sm text-(--text-secondary) leading-relaxed list-disc"
                      >
                        {change}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
