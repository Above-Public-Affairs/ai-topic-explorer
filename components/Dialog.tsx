"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Safari and iOS don't focus a button when it's clicked or tapped, so at
// open time document.activeElement is <body> or <main>, not the opener.
// Remember the last control pressed so focus can go back to it on close.
let lastPressed: { el: HTMLElement; at: number } | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>("button, a[href], [role='button']") : null;
      lastPressed = el ? { el, at: Date.now() } : null;
    },
    true
  );
}

/** The element that opened the dialog: what has focus, or else the control just pressed. */
function findOpener(): HTMLElement | null {
  const active = document.activeElement;
  const focusedControl =
    active instanceof HTMLElement && active !== document.body && active.tagName !== "MAIN" ? active : null;
  if (focusedControl) return focusedControl;
  if (lastPressed && lastPressed.el.isConnected && Date.now() - lastPressed.at < 5000) return lastPressed.el;
  return null;
}

interface Props {
  /** id of the element that names the dialog, usually its heading. */
  labelledBy: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * A modal built on the native <dialog>. Mount it to open it, unmount it to
 * close it. showModal() makes the page behind inert, holds focus inside and
 * handles Escape; this adds a click-outside close, a body scroll lock, and
 * returns focus to whatever opened it.
 */
export default function Dialog({ labelledBy, onClose, className = "", children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const opener = findOpener();
    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      opener?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        // Escape: let React unmount us rather than the browser closing it.
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={(e) => {
        // Clicks on the backdrop land on the <dialog> itself, outside its box.
        if (e.target !== ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const inside =
          e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inside) onCloseRef.current();
      }}
      className={`glass-tier-3 m-auto w-[calc(100%-2rem)] max-h-[80vh] p-0 rounded-2xl shadow-xl text-(--text-primary) backdrop:bg-black/30 backdrop:backdrop-blur-sm open:animate-fade-in ${className}`}
    >
      {children}
    </dialog>
  );
}
