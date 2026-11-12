"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * Keeps a toggle button where the reader is looking when the content above it
 * collapses. Without this, "Show less" at the end of a long answer shrinks the
 * page by thousands of pixels and leaves the reader far below what they were
 * reading.
 *
 * Call `hold()` just before the state change; after React re-renders, the page
 * scrolls by however far the button moved, so it stays under the pointer.
 */
export function useKeepInView<T extends HTMLElement>(ref: RefObject<T | null>) {
  const before = useRef<number | null>(null);

  useLayoutEffect(() => {
    const top = before.current;
    before.current = null;
    const el = ref.current;
    if (top === null || !el) return;
    const moved = el.getBoundingClientRect().top - top;
    if (Math.abs(moved) > 1) window.scrollBy({ top: moved, behavior: "instant" });
  });

  return {
    hold() {
      if (ref.current) before.current = ref.current.getBoundingClientRect().top;
    },
  };
}
