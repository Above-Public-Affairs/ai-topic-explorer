"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "beta-banner-dismissed";

// Dismissal lives in localStorage, so the banner is read as an external
// store: hidden on the server, then shown on the client unless dismissed.
// Dismissing in a storage-blocked browser still hides it for this page view.
let dismissedThisSession = false;
const listeners = new Set<() => void>();

function isDismissed(): boolean {
  if (dismissedThisSession) return true;
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function dismiss() {
  dismissedThisSession = true;
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {}
  listeners.forEach((listener) => listener());
}

export default function BetaBanner() {
  const visible = !useSyncExternalStore(subscribe, isDismissed, () => true);
  const handleDismiss = dismiss;

  if (!visible) return null;

  return (
    <div className="w-full bg-[--accent-cyan]/[0.07] border-b border-[--accent-cyan]/15">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
        <p className="text-sm text-[--text-secondary]">
          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-semibold bg-[--accent-cyan]/10 text-[--accent-cyan] mr-2">
            Beta
          </span>
          This site is in beta &mdash; if something seems off, let us know via
          Report a Bug below.
        </p>
        <button
          onClick={handleDismiss}
          className="shrink-0 text-[--text-tertiary] hover:text-[--text-primary] transition-colors text-lg leading-none p-1"
          aria-label="Dismiss beta banner"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
