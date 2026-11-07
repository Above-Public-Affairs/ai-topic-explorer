"use client";

export const BETA_DISMISSED_KEY = "beta-banner-dismissed";

export default function BetaBannerDismiss() {
  return (
    <button
      type="button"
      onClick={() => {
        document.documentElement.setAttribute("data-beta-dismissed", "");
        try {
          localStorage.setItem(BETA_DISMISSED_KEY, "1");
        } catch {}
        document.getElementById("content")?.focus({ preventScroll: true });
      }}
      className="shrink-0 -mr-2 size-10 inline-flex items-center justify-center rounded-full text-(--text-tertiary) hover:text-(--text-primary) hover:bg-black/5 transition-colors active:scale-[0.96]"
      aria-label="Dismiss beta banner"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}
