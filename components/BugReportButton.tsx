"use client";

import { useId, useState } from "react";
import Dialog from "@/components/Dialog";
import CloseButton from "@/components/CloseButton";
import { trackEvent } from "@/lib/analytics";
import { PRIVACY_POLICY_URL } from "@/lib/privacy";

export default function BugReportButton() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const headingId = useId();
  const close = () => setOpen(false);

  const handleOpen = () => {
    setOpen(true);
    setStatus("idle");
    setDescription("");
    trackEvent("modal_opened", { modal: "bug_report" });
  };

  const handleSubmit = async () => {
    if (!description.trim()) return;
    setStatus("submitting");

    try {
      const res = await fetch("/api/bug-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description.trim(),
          pageUrl: window.location.href,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        }),
      });

      if (res.ok) {
        trackEvent("bug_report_sent");
        setStatus("success");
        setDescription("");
        setTimeout(() => {
          setOpen(false);
          setStatus("idle");
        }, 2000);
      } else {
        trackEvent("error_shown", { error_type: "send_failed", error_area: "bug_report" });
        setStatus("error");
      }
    } catch {
      trackEvent("error_shown", { error_type: "network", error_area: "bug_report" });
      setStatus("error");
    }
  };

  return (
    <>
      {/* Floating pill button */}
      <button
        type="button"
        onClick={handleOpen}
        // An icon-only 44px circle below lg, so it doesn't sit over the text.
        className="fixed bottom-4 right-4 lg:bottom-6 lg:right-6 z-40 flex size-11 lg:size-auto items-center justify-center gap-2 lg:px-4 lg:py-2.5 rounded-full glass-tier-3 text-sm font-medium text-(--text-secondary) hover:text-(--accent-cyan) hover:border-(--accent-cyan)/30 shadow-lg hover:shadow-xl transition-[color,border-color,box-shadow,scale] duration-200 active:scale-[0.96]"
        aria-label="Report a bug"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 2l1.88 1.88M14.12 3.88L16 2M9 7.13v-1a3.003 3.003 0 116 0v1" />
          <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 014-4h4a4 4 0 014 4v3c0 3.3-2.7 6-6 6z" />
          <path d="M12 20v2M6 13H2M22 13h-4M6 17H3.5M20.5 17H18M6 9H3.5M20.5 9H18" />
        </svg>
        <span className="hidden lg:inline" aria-hidden="true">Report a Bug</span>
      </button>

      {/* Modal */}
      {open && (
        <Dialog labelledBy={headingId} onClose={close} className="max-w-md">
          <div className="p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4 mb-2">
              <h2 id={headingId} className="text-xl font-bold text-(--text-primary)">
                Report a Bug
              </h2>
              <CloseButton onClick={close} className="-mt-2" />
            </div>
            <p className="text-sm text-(--text-secondary) mb-4">
              Describe what went wrong and we&apos;ll look into it.
            </p>

            {status === "success" ? (
              <div className="text-center py-6" role="status">
                <p className="text-(--accent-cyan) font-semibold">
                  Thank you!
                </p>
                <p className="text-sm text-(--text-tertiary) mt-1">
                  Your report has been submitted.
                </p>
              </div>
            ) : (
              <>
                <textarea
                  id="bug-report-description"
                  name="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What happened? What did you expect?"
                  maxLength={2000}
                  rows={4}
                  className="w-full px-4 py-3 text-base rounded-xl bg-white/80 border border-black/12 text-(--text-primary) placeholder-(--text-tertiary) focus:outline-none focus-visible:border-(--accent-cyan) focus-visible:ring-2 focus-visible:ring-(--accent-cyan) focus-visible:ring-offset-2 focus-visible:ring-offset-white focus:bg-white/90 backdrop-blur-xl transition-[background-color,border-color,box-shadow] duration-200 resize-none"
                  disabled={status === "submitting"}
                  aria-label="Bug description"
                />
                <div className="flex items-start justify-between gap-4 mt-1 mb-4">
                  <p className="text-xs text-(--text-tertiary) text-pretty">
                    Page URL and browser info included automatically.{" "}
                    <a
                      href={PRIVACY_POLICY_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-(--accent-cyan) hover:text-(--accent-violet) transition-colors underline underline-offset-2"
                    >
                      Privacy policy
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </p>
                  <span className="shrink-0 text-xs tabular-nums text-(--text-tertiary)">
                    {description.length}/2000
                  </span>
                </div>

                {status === "error" && (
                  <p className="text-sm text-red-700 mb-3" role="alert">
                    Failed to submit. Please try again.
                  </p>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={!description.trim() || status === "submitting"}
                  className="btn-primary w-full px-4 py-2.5 rounded-xl text-sm"
                >
                  {status === "submitting" ? "Submitting..." : "Submit Report"}
                </button>
              </>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
