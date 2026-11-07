# Accessibility audit: aitopicexplorer.app (task 6.3)

**Date:** 2026-11-07 · **Standard:** WCAG 2.2 AA · **Site build:** live `main` at 5b42496
**For:** task 6.6 (fixes). This is a review only; no app code was changed.

## What was tested

| Surface | URL / state | Widths | Schemes |
|---|---|---|---|
| Home page | https://aitopicexplorer.app | 1280 desktop, 375, 320 | light, dark |
| Analysis in progress | Home page after submit. The `/api/analyze` stream was **stubbed in the browser** (fake SSE: 4 providers, Claude done, Grok failed), so **no live analysis was run and nothing was spent**. | desktop | light |
| Results, new layout | /results/cmw6z5qiv00cy0xp9ykugrp9s (answer tabs, themes, arguments, entities, sources) | desktop, 375, 320 | light, dark |
| Results, old layout | /results/cmw6npuvh00000xodn59t6u9e (themes, entities, citations, X perspective) | desktop | light |

Method: keyboard walk-throughs (Tab, Shift+Tab, Enter, Escape, arrows) with a `focusin` logger; computed-style contrast for every visible text node, composited over the real glass backgrounds; DOM checks for names, roles, landmarks, headings, live regions and target sizes; source read of `app/` and `components/`. A real screen reader was not run. Where a finding says a screen reader announces something, that is inferred from the DOM and roles, not heard.

## Summary

| Severity | Count |
|---|---|
| Critical | 2 |
| High | 8 (including root cause 0) |
| Medium | 6 |
| Low | 6, plus 1 note |

**Read finding 0 first.** It isn't a WCAG failure on its own, but it changes what most of the others look like once it's fixed.

---

## 0. Root cause to fix first: 150 Tailwind classes produce no CSS

**Severity:** High (blocks correct fixes; latent contrast failures) · **Where:** 19 files in `app/` and `components/` (every file using `text-[--x]`, `bg-[--x]`, `border-[--x]`, `ring-[--x]`, `decoration-[--x]`)

The project is on Tailwind v4 (`"tailwindcss": "^4"`). In v4 the CSS-variable shorthand is `text-(--text-secondary)`; the v3 form `text-[--text-secondary]` generates nothing. Confirmed on the live site: there is no stylesheet rule for `.text-\[--text-secondary\]`, and the home intro paragraph, which has that class, renders `rgb(26,26,46)` (the inherited `--text-primary`). 14 distinct such classes are on the home page alone and about 150 uses across the codebase.

What this means today:
- All "secondary", "tertiary" and "accent cyan" text renders as primary near-black. So, **by accident, most body text currently passes contrast**.
- Every focus ring, focus border, cyan link color, hover color and tinted background written this way is missing. Finding 4 (no focus on the search input) is caused by this.

Why it matters for 6.6: if the classes are converted to `(--x)` as they are, these become real failures (measured against `#F8F6F3` cream / the glass-tier-2 surface):

| Token | Value | On cream | On glass-2 | AA normal text |
|---|---|---|---|---|
| `--text-tertiary` | `#94a3b8` | **2.38:1** | **2.48:1** | fail |
| `--accent-cyan` (links, "How does this work?", entity group headings, `<mark>`) | `#0891b2` | **3.41:1** | **3.56:1** | fail |
| `--text-secondary` | `#64748b` | **4.41:1** | 4.60:1 | fails on cream and on the cyan-tinted callout (4.24:1) |
| `--accent-violet` | `#7c3aed` | 5.28:1 | 5.51:1 | pass |

**Fix:** convert the syntax (a codemod: `-[--` → `-(--`, with `/NN` opacity modifiers kept) **and** darken the tokens in `app/globals.css` in the same change, for example `--text-tertiary: #5b6577` (5.45:1 on cream, 5.23:1 on the cyan tint), `--text-secondary: #475569` (7.02:1), `--accent-cyan: #0e7490` (4.97:1 on cream, 4.77:1 on the tint). The current `#64748b` is 4.41:1, just short of 4.5:1, so don't reuse it as the tertiary color. Re-run the contrast check after. Coordinate with 6.5 (design), which will also see the colors change.

---

## Critical

### 1. Pop-ups are not dialogs: focus isn't moved, held or returned
**WCAG:** 4.1.2 Name, Role, Value; 2.4.3 Focus Order; 1.3.1 · **Where:** `components/WordContextModal.tsx:51-104` (theme-in-context, both layouts), `app/page.tsx:630-688` (How it works), `components/BugReportButton.tsx:89-164`, `components/Footer.tsx:~158-200` (Changelog)

**Reproduce (results page):** Tab to a theme chip ("Growth projections") and press Enter. The modal opens, but `document.activeElement` is still the chip behind it. Press Tab: focus moves to the next chip ("Local water strain") **behind the overlay**. Nothing has `role="dialog"`, `aria-modal` or `aria-labelledby`, so a screen reader is not told a dialog opened. The background still scrolls (`body` overflow stays `visible`). Escape does close it, but focus stays wherever it had wandered.
**Home "How does this work?":** same problems, and **Escape does nothing** (no key handler). Its close button is an unlabeled `×`, which is read as "times" (`app/page.tsx:640-645`).

**Fix:** one shared `<Dialog>` used by all four, preferably the native `<dialog>` element with `showModal()`, which provides modality, Escape handling, an inert background and top-layer stacking. It needs `aria-labelledby` pointing at its heading. On open, focus the close button or the heading (`tabIndex={-1}`). On close, return focus to the button that opened it. Lock body scroll while open. Add `aria-label="Close"` to the How-it-works close button.

### 2. Floating keywords move forever with no way to stop them, and screen readers read them
**WCAG:** 2.2.2 Pause, Stop, Hide (Level A); 1.3.1 · **Where:** `components/FloatingKeywords.tsx` (render around lines 262-288), `app/globals.css:224-254` (`float-drift`), `app/page.tsx:521-523`

**Reproduce:** open the home page at ≥768px. 24 pills drift and fade in infinite 18–30s loops beside the search form. There is no pause control and no `prefers-reduced-motion` handling anywhere in the codebase (searched: no `reduce`, `motion-reduce` or `matchMedia`). The pills have no `aria-hidden`, so a screen reader reads 24 unrelated words ("Penicillin", "Safety Glass"…) right after the page intro.

**Fix:** put `aria-hidden="true"` on the FloatingKeywords wrapper (it's decorative). Add `@media (prefers-reduced-motion: reduce) { .animate-float-drift { animation: none; opacity: .9 } }`. For 2.2.2 with motion allowed, also stop the animation after one cycle or 5s, or add a visible pause button. Stopping after a few seconds is the simplest.

---

## High

### 3. Provider name badges are 1.8–2.6:1 contrast at 10px
**WCAG:** 1.4.3 Contrast (Minimum) · **Where:** `lib/providers.ts:16-22` (`PROVIDER_COLORS`), used by `components/ArgumentColumns.tsx:13`, `EntityGroups.tsx:38`, `CitationList.tsx:66-70`, `WordContextModal.tsx:84`, `EntityList.tsx`, and the hard-coded Grok badge in `app/results/[id]/ResultsContent.tsx:140`

**Measured on live:** ChatGPT `emerald-400` on `emerald-50` **1.84:1**, Claude `orange-400` **2.24:1**, Gemini `blue-400` **2.43:1**, Grok `red-400` **2.64:1**. 10px text, about 80 instances on the new results page and about 80 on the old one. These badges are the only place that says which AI made an argument or named an entity.

**Fix:** use `-700` text on `-50` (all ≥5.5:1), and raise the size to `text-[11px]` or `text-xs`. One edit in `PROVIDER_COLORS` fixes most of them. Update the Grok badge in `ResultsContent.tsx:140` as well.

### 4. Search input has no visible focus indicator
**WCAG:** 2.4.7 Focus Visible · **Where:** `app/page.tsx:554`

**Reproduce:** load home, press Tab twice (past the beta-banner ×). Focus is on the input (`:focus-visible` true), but computed `outline: none` and `box-shadow` is unchanged. `focus:outline-none` removes the outline, and the replacement `focus:ring-[--accent-cyan]/15` / `focus:border-[--accent-cyan]/50` produce no CSS (finding 0). Only the text caret shows. The bug-report textarea (`BugReportButton.tsx:134`) has the same classes.

**Fix:** drop `focus:outline-none`, or replace it with a real ring, e.g. `focus-visible:ring-2 focus-visible:ring-(--accent-cyan) focus-visible:ring-offset-2`. That ring must reach 3:1 against the cream background, so use a cyan at least as dark as `#0e7490`.

### 5. Search input has no label, and its placeholder changes every 5 seconds
**WCAG:** 1.3.1, 3.3.2 Labels or Instructions, 4.1.2 · **Where:** `app/page.tsx:548-556`

**Reproduce:** inspect the input: there is no `<label>`, no `aria-label` and `input.labels.length === 0`. Its only name is the placeholder, which rotates every 5s (`createRotatingStore(…, 5000)`, line 313) and disappears once typing starts.

**Fix:** add `<label htmlFor="topic" className="sr-only">Topic to explore</label>` (or a visible label) and `id="topic"`. Keep the rotating placeholder as a hint only.

### 6. Analysis progress isn't announced, and focus drops to the page body
**WCAG:** 4.1.3 Status Messages; 2.4.3 Focus Order · **Where:** `app/page.tsx:371-378, 555-559`, `components/AnalysisProgressPanel.tsx:36-67`

**Reproduce (stubbed stream):** type a topic and press Enter. The input and button both become `disabled`, so focus is dropped to `<body>` (logged `focusout` from the INPUT, `activeElement` = BODY). The panel ("Asking each AI…", per-AI status, elapsed seconds) has no `aria-live` or `role="status"`, and there are none on the page. A screen-reader user hears nothing during a run of up to about 50s, and nothing when the page then navigates to the results.

**Fix:** wrap the stage message in `role="status"` (polite) and announce only stage changes and each AI finishing ("Claude answered", "Grok failed: timed out"). Don't announce the seconds counter: give it `aria-hidden`, or leave it outside the live region. Set `readOnly`/`aria-disabled` on the input and button instead of `disabled`, or move focus to the progress panel (`tabIndex={-1}`) on submit. On the results page, see finding 11 (title) and focus the topic heading on load.

### 7. AI status is shown by color alone, and the "done" text is 3.47:1
**WCAG:** 1.4.1 Use of Color; 1.4.3 · **Where:** `components/ProgressTracker.tsx:17-57` (in-progress panel, results sidebar, results mobile header)

**Reproduce:** in the progress panel, "Claude" (done) and "ChatGPT" (still working) differ only in dot color and glow, and text color (`emerald-600` vs default). "Done" text is `emerald-600` at 12px: **3.47:1**. "Failed" adds "(timed out)" in text, so that state is fine.

**Fix:** add the state in text, visibly or `sr-only`: "Claude: answered", "ChatGPT: working", or a ✓ / spinner / ! icon with an accessible name. Darken done text to `emerald-700` (≥5:1).

### 8. Error messages aren't announced, and are 3.49:1
**WCAG:** 3.3.1 Error Identification; 4.1.3; 1.4.3 · **Where:** `app/page.tsx:572-574` (empty topic, rate limit, timeout, stream error), `components/BugReportButton.tsx:147-151`

**Reproduce:** submit an empty topic. "Please enter a topic to explore." appears as a plain `<p>`, with no `role="alert"`, no `aria-describedby` from the input and no `aria-invalid`. `text-red-500` on cream is **3.49:1**.

**Fix:** use `role="alert"` on the error paragraph, plus `aria-invalid` and `aria-describedby="topic-error"` on the input. Use `text-red-700` (≈6:1).

### 9. Results pages have no `<main>` landmark and no skip link
**WCAG:** 2.4.1 Bypass Blocks; 1.3.1 · **Where:** `components/ResultsShell.tsx:59-191`, `app/layout.tsx:55-71`

**Reproduce:** the landmarks on the new results page are `aside`, `nav` and `footer` only. Content sits in a plain `div` (`ResultsShell.tsx:177`). On desktop a keyboard user tabs through the sidebar (5 section links, Share, New Topic, footer links) before reaching any result. The home page has `<main>`, but neither page has a skip link. The mobile sticky header is a `div` rather than a `header`.

**Fix:** use `<main id="content">` for `ResultsShell.tsx:177`, and add a "Skip to results" link (visible on focus) as the first child of `body` in `app/layout.tsx`, targeting `#content`. Make the mobile sticky bar a `<header>`.

---

## Medium

### 10. Collapsed answers: Tab moves focus into the hidden, faded part
**WCAG:** 2.4.7 / 2.4.11 Focus Not Obscured (Minimum) · **Where:** `components/AnswerTabs.tsx:72-78`

**Reproduce:** desktop, Answers, ChatGPT tab (collapsed at 480px with a 7rem fade mask). Tab out of the tab list: 3 of the 4 inline links in the answer are inside the faded or clipped zone (focus landed on links at y=492 and y=396 inside a body ending at y=576, the bottom 112px being mask-faded). Further links below `max-height` are fully clipped but still focusable.

**Fix:** while collapsed, mark the overflow `inert`. Easiest is to auto-expand on focus: `onFocusCapture={() => setExpanded(true)}` on the body wrapper.

### 11. Every page has the same title, "AI Topic Explorer"
**WCAG:** 2.4.2 Page Titled · **Where:** `app/results/[id]/page.tsx` (no `generateMetadata`); `app/layout.tsx:27`

**Reproduce:** both results pages report `document.title === "AI Topic Explorer"`. Tabs, history and screen-reader page announcements can't tell results apart, and after an analysis finishes nothing signals the new page.

**Fix:** add `generateMetadata` to `app/results/[id]/page.tsx` returning `` `${topic} – AI Topic Explorer` ``. Also good for sharing previews.

### 12. Sticky mobile header and the floating bug button cover focused content
**WCAG:** 2.4.11 Focus Not Obscured (Minimum) · **Where:** `components/ResultsShell.tsx:61` (sticky header: 103px at 375px wide, 123px at 320px), `components/BugReportButton.tsx:67` (fixed bottom-right)

**Reproduce:** at 375×812, Shift+Tab upward through results: the browser scrolls the focused element to the top edge, under the sticky header. At the bottom, the "Report a Bug" pill sits over theme chips ("Incomplete reporting" in the 375px screenshot) and the "How does this work?" line on the home page. In landscape phone sizes the header takes about 40% of the height.

**Fix:** on results pages, `html { scroll-padding-top: <header height + 8px> }` (lg: 0). Add `padding-bottom` to `body` or the page wrapper at least the bug button's height plus offset (about 72px). Consider collapsing the mobile header's provider row on scroll.

### 13. "Link copied!" isn't announced
**WCAG:** 4.1.3 · **Where:** `components/ResultsShell.tsx:69-74, 158-163`

**Fix:** keep the button label static and add a visually hidden `role="status"` span that gets "Link copied" for 2s.

### 14. Theme-in-context excerpts show raw Markdown
**WCAG:** 1.3.1 / readability (cognitive) · **Where:** `components/WordContextModal.tsx:90-96`, excerpts from `lib/analysis/word-context` (`findWordContext`)

**Reproduce:** open "Growth projections" on the new results page. Excerpts read `**Projections**`, `- **Possible growth:** …`, `**29 billion`. Screen readers read "star star". Sighted users see clutter. Excerpts are cut from the raw answer Markdown.

**Fix:** strip Markdown before splitting into sentences, e.g. render with `remark` and take its text, or a small strip of `**`, `__`, leading `-`/`*`/`#`, and `[text](url)` → `text`.

### 15. Theme chips cut off long themes with no way to read the full text
**WCAG:** 1.4.10 Reflow / 1.4.4 (partial) · **Where:** `components/KeyThemes.tsx:34` (`max-w-full truncate`)

At 320px, or at 200% zoom, long theme labels are truncated with an ellipsis. The full text reaches assistive tech but not sighted users, and there's no `title`. **Fix:** allow wrapping (`whitespace-normal text-balance`, rounded-2xl for multi-line) instead of `truncate`.

---

## Low

### 16. Heading levels skip
**WCAG:** 1.3.1 (best practice) · **Where:** `components/AnswerTabs.tsx:95` ("Sources it cited" is an `h4` directly under the `h2` "Answers"), `components/QuotedPhrases.tsx:22` (`h4` under `h2` "X Perspective"). Desktop also has the topic as both the sidebar `h1` and a duplicate `h2` (`RunResultsContent.tsx:70`, `ResultsContent.tsx:94`). **Fix:** make "Sources it cited" an `h3` (AnswerProse already maps answer headings to h3–h5, so give the answer's own headings h4+ if you want them nested under it). Make the duplicate desktop topic a `p`, or make the sidebar topic a `p` and keep the `h2` as an `h1`.

### 17. Small text-link targets
**WCAG:** 2.5.8 Target Size (Minimum) passes through the spacing exception; below house 44px guidance · **Where:** footer "The Canter Company" (15px tall) and "Changelog" (16px) in `components/Footer.tsx`; "How does this work?" (20px) `app/page.tsx:610-618`; beta banner × (20×26) `components/BetaBanner.tsx:51-57`; mobile section jump links (16px) `components/ResultsShell.tsx:89-99`; "source" links (15px) `ArgumentColumns.tsx:39-46`. **Fix:** add `py-2`/`min-h-6` (24px) at least, and 44px for the mobile jump links and the beta ×.

### 18. Other animations ignore reduced-motion
**WCAG:** 2.3.3 (AAA), best practice · **Where:** `app/globals.css` (`fade-in`, `fade-in-up`, `pulse-glow`, `ellipsis-pulse`, `html { scroll-behavior: smooth }`), Tailwind `animate-spin`, `active:scale-[0.96]` presses. **Fix:** one global block: `@media (prefers-reduced-motion: reduce) { *, ::before, ::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important } }`.

### 19. Old layout: "Common Talking Points" label 3.65:1
**WCAG:** 1.4.3 · **Where:** `components/QuotedPhrases.tsx:22` (`text-blue-500`, 12px). **Fix:** `text-blue-700`. (The large decorative quote mark, `text-blue-200`, is decorative and exempt; add `aria-hidden`.)

### 20. The mobile topic heading is cut off
**Where:** `components/ResultsShell.tsx:65` (`truncate`). At 375px "water use by Texa…" shows, and the full topic appears nowhere else on mobile (the desktop `h2` is `hidden lg:block`). **Fix:** let it wrap to two lines (`line-clamp-2`), or show the full topic as the first line of the content on mobile.

### 21. Links open new tabs without saying so
**WCAG:** 3.2.5 (AAA) / G201 advisory · **Where:** all `target="_blank"` links (`AnswerProse.tsx:21-30`, `AnswerTabs.tsx:104-111`, `CitationList.tsx`, `EntityGroups.tsx`, `ArgumentColumns.tsx`). **Fix:** add an `sr-only` " (opens in a new tab)" in a shared `ExternalLink` component, optionally with a small ↗ icon.

### 22. No dark theme (note, not a failure)
In dark mode the site stays fully light (`body` background `#F8F6F3`, no `prefers-color-scheme` rules), so dark mode introduces no contrast failures. If 6.5 adds a dark theme, re-run this contrast pass on it. Until then, consider `<meta name="color-scheme" content="light">` so form controls and scrollbars don't render dark-styled on the light page.

---

## Checked and passing

- `lang="en"` on `<html>`.
- **Answer tabs:** a correct ARIA tabs pattern (`role="tablist"` with a label, roving `tabIndex`, ←/→/Home/End wrap, `aria-selected`, `aria-controls`/`aria-labelledby`). Tabs are 40px tall (65px wide at 320px). Failed answers carry an `sr-only` "(no answer)". Browser default focus ring is visible.
- "Read the full answer" and "Show all N" use `aria-expanded`; both are 40px tall.
- **Reflow:** no horizontal scroll at 320px on the home page or the new results page; the tab list fits (286/286).
- Escape closes the theme-in-context, bug-report and changelog modals (not How it works; see finding 1).
- `<mark>` highlighting in the context modal renders browser-default black on yellow (high contrast), because its intended cyan styles are among the classes that produce no CSS (finding 0). Don't adopt cyan-on-cyan-tint when fixing; it would be about 3.3:1.
- Example topic pills (38px tall) and the Explore button (54px) are keyboard-reachable with the default focus ring.
- No images of text, no auto-playing audio, no flashing content, no time limits on users (the 3-minute analysis timeout is server-side, with a plain-language error).
- Tone badges (`emerald/amber/rose-700` on `-50`) pass.

## Suggested order for 6.6

1. Finding 0: syntax codemod plus token darkening, together, then re-run contrast.
2. Shared Dialog component (1) and FloatingKeywords `aria-hidden` / reduced motion (2).
3. Home form: label (5), focus ring (4), errors (8), progress announcements and focus (6, 7).
4. `PROVIDER_COLORS` (3), `<main>` and skip link (9), page titles (11).
5. Mediums 10, 12–15, then lows.

The contrast numbers come from a browser script that composites each text node's color over its ancestors' backgrounds (see Method). After the fixes, run axe DevTools or Lighthouse accessibility as a second check, and do one VoiceOver pass over the dialog and the progress announcements.
