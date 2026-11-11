/**
 * Google Analytics 4: the one place event names and their params are defined.
 *
 * gtag.js loads lazily (after the page is idle), but a tiny inline stub in
 * <head> (see `gaBootstrapScript`) defines `window.gtag` before anything else
 * runs. Until gtag.js arrives, every call is queued in `window.dataLayer` and
 * gtag.js replays the queue when it loads, so no event is lost.
 *
 * No personal data goes to GA: no user IDs, no email, no full source URLs.
 * GA4 never logs or stores IP addresses. Google signals and ad
 * personalization are off.
 */

type Placement = "header" | "sidebar";

/** Every event the site sends, with its params. Add new events here only. */
export interface AnalyticsEvents {
  /** The topic as typed (GA keeps the first 100 characters of a param). */
  topic_searched: { topic: string; topic_length: number };
  example_topic_clicked: { topic: string };
  analysis_started: { topic_length: number };
  analysis_completed: { duration_sec: number; ais_answered: number; ais_asked: number };
  /** The visitor closed or left the page while an analysis was still running. */
  analysis_abandoned: { duration_sec: number; stage: string; ais_answered: number };
  error_shown: { error_type: ErrorType; error_area: "analysis" | "bug_report" };
  results_viewed: { layout: "new" | "old"; ais_answered: number; from_share: boolean };
  /** GA's recommended `share` event: the share button copied the results link. */
  share: { method: "copy_link"; content_type: "results"; item_id: string; placement: Placement };
  /** Someone opened a results link that came from the share button. */
  shared_link_opened: { item_id: string };
  /** A link to a source an AI cited. Domain only, never the full URL. */
  source_link_opened: { source_domain: string; link_area: SourceLinkArea };
  /** Theme and word clicks open the word-context pop-up; those are counted as theme_clicked and word_clicked. */
  modal_opened: { modal: "how_it_works" | "changelog" | "bug_report" };
  theme_clicked: { theme: string };
  word_clicked: { word: string };
  answer_tab_selected: { provider: string };
  answer_expanded: { provider: string };
  new_topic_clicked: { placement: Placement };
  bug_report_sent: Record<string, never>;
}

export type AnalyticsEventName = keyof AnalyticsEvents;

// Every event name at runtime (tests, docs). Typed against the catalog, so
// adding an event without listing it here fails the type check.
const EVENT_NAMES: Record<AnalyticsEventName, true> = {
  topic_searched: true,
  example_topic_clicked: true,
  analysis_started: true,
  analysis_completed: true,
  analysis_abandoned: true,
  error_shown: true,
  results_viewed: true,
  share: true,
  shared_link_opened: true,
  source_link_opened: true,
  modal_opened: true,
  theme_clicked: true,
  word_clicked: true,
  answer_tab_selected: true,
  answer_expanded: true,
  new_topic_clicked: true,
  bug_report_sent: true,
};
export const ANALYTICS_EVENT_NAMES = Object.keys(EVENT_NAMES) as AnalyticsEventName[];

export type ErrorType =
  | "rate_limit"
  | "unavailable"
  | "api_error"
  | "stream_error"
  | "ended_early"
  | "timeout"
  | "network"
  | "send_failed";

export const SOURCE_LINK_AREAS = ["answer_inline", "answer_sources", "citation_list", "argument_list"] as const;
export type SourceLinkArea = (typeof SOURCE_LINK_AREAS)[number];

/** Marks a link to a cited source; the click listener in `AnalyticsTracker` reads it. */
export const SOURCE_LINK_ATTR = "data-source-link";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    /** Set by the bootstrap script when GA DebugView is on for this tab. */
    __gaDebug?: boolean;
  }
}

/** Send one event. A no-op on the server and when GA isn't configured. */
export function trackEvent<E extends AnalyticsEventName>(
  name: E,
  ...[params]: AnalyticsEvents[E] extends Record<string, never> ? [] : [AnalyticsEvents[E]]
): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, withDebug({ ...params }));
}

/**
 * DebugView only sees hits that carry `debug_mode` themselves: set on
 * `config` it doesn't reach the hits (checked against gtag.js, Nov 2026).
 */
function withDebug<T extends object>(params: T): T & { debug_mode?: true } {
  return window.__gaDebug ? { ...params, debug_mode: true } : params;
}

let lastPageLocation: string | null = null;

/**
 * Page views. GA's `config` sends the first one when the page loads (it does
 * so even with `send_page_view: false`, so the site doesn't fight it). The
 * App Router changes pages without a reload, so this is called on every
 * route change: the first call only notes the landing URL, and each later
 * URL gets one page view, never the same URL twice in a row (React's double
 * effects in development, a re-render). GA's own "browser history" page
 * views must be off in the stream's enhanced measurement settings.
 */
export function trackPageView(href?: string): void {
  if (typeof window === "undefined" || !window.gtag) return;
  const location = href ?? window.location.href;
  if (location === lastPageLocation) return;
  const referrer = lastPageLocation;
  lastPageLocation = location;
  if (referrer === null) return; // the landing page: GA counted it
  window.gtag(
    "event",
    "page_view",
    withDebug({ page_location: location, page_referrer: referrer, page_title: document.title })
  );
}

/** For tests: forget the last page view. */
export function resetPageViewMemory(): void {
  lastPageLocation = null;
}

/** The registrable-looking host of a URL, without "www.", or null if it isn't an http(s) URL. */
export function linkDomain(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Whole seconds since a `performance.now()` reading. */
export function secondsSince(start: number): number {
  return Math.round((performance.now() - start) / 1000);
}

/**
 * The inline <head> script: defines the gtag queue and configures the
 * property. `?ga_debug=1` on any URL turns on GA DebugView for the rest of
 * the tab's session (debug hits are kept out of GA's reports).
 */
export function gaBootstrapScript(measurementId: string, forceDebug = false): string {
  const id = JSON.stringify(measurementId);
  return [
    "window.dataLayer=window.dataLayer||[];",
    "function gtag(){dataLayer.push(arguments);}",
    "window.gtag=gtag;",
    `var d=${forceDebug ? "true" : "false"};`,
    "try{if(/[?&]ga_debug=1(&|$)/.test(location.search))sessionStorage.setItem('ga_debug','1');d=d||sessionStorage.getItem('ga_debug')==='1';}catch(e){}",
    "var c={allow_google_signals:false,allow_ad_personalization_signals:false};",
    // Any debug_mode value, even false, turns DebugView on, so only set it when wanted.
    "if(d){c.debug_mode=true;window.__gaDebug=true;}",
    "gtag('js',new Date());",
    `gtag('config',${id},c);`,
  ].join("");
}
