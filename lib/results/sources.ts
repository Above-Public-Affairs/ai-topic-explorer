/**
 * Display clean-up for the sources and prose on the results page. None of
 * this touches stored data: answers stay exactly as each AI wrote them.
 */

const TRACKING_PARAM = /^(utm_.+|ref|ref_src|fbclid|gclid|mc_cid|mc_eid)$/i;

/** The URL to link to: tracking parameters (e.g. `?utm_source=openai`) and the fragment removed. */
export function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    const tracking = [...u.searchParams.keys()].filter((key) => TRACKING_PARAM.test(key));
    if (tracking.length === 0 && !u.hash) return url;
    for (const key of tracking) u.searchParams.delete(key);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * A URL reduced to a key for de-duplication: no tracking parameters, no
 * fragment, no `www.`, no trailing slash, lower case.
 */
export function urlKey(url: string): string {
  try {
    const u = new URL(cleanUrl(url));
    u.hostname = u.hostname.replace(/^www\./, "");
    return u.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const ACRONYMS: Record<string, string> = { ai: "AI", us: "US", uk: "UK", eu: "EU", ercot: "ERCOT", tceq: "TCEQ", puc: "PUC" };

/** A readable title from the URL's last path segment ("texas-water-supply-stress.html" → "Texas water supply stress"), or null. */
function titleFromPath(url: string): string | null {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const words = decodeURIComponent(segments.at(-1) ?? "")
      .replace(/\.[a-z0-9]{2,5}$/i, "")
      .split(/[-_+\s]+/)
      // Drop ids: numbers ("21307067") and hex or mixed fragments ("7ddb60fe").
      .filter((w) => /^[a-z]+$/i.test(w) || (/^\d{1,2}$/.test(w)));
    // Needs a few real words; skip ids like "1532" or "page".
    if (words.filter((w) => /[a-z]/i.test(w)).length < 3) return null;
    const text = words.map((w) => ACRONYMS[w.toLowerCase()] ?? w.toLowerCase()).join(" ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  } catch {
    return null;
  }
}

/**
 * The title to show for a source. Titles scraped from PDFs and pages are
 * sometimes a header ("OCTOBER 2025"), a whole paragraph, or just the domain;
 * those fall back to a title made from the URL, then the domain.
 */
export function cleanTitle(title: string | null | undefined, url: string, domain: string): string {
  const t = (title ?? "")
    .replace(/^#+\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  // All caps is fine for a short name ("ERCOT"), not for a PDF header or a
  // date ("OCTOBER 2025", "WATER USE REQUIREMENTS FOR…").
  const shouting = !/[a-z]/.test(t) && (/\d/.test(t) || t.split(" ").length > 3);
  const usable =
    t.length >= 2 &&
    t.length <= 140 &&
    !shouting &&
    !/^©/.test(t) &&
    t.toLowerCase() !== domain.toLowerCase();
  if (usable) return t;
  return titleFromPath(url) ?? domain;
}

/** URLs linked from Markdown prose, in the order they first appear. */
export function linkedUrls(markdown: string): string[] {
  const out: string[] = [];
  for (const m of markdown.matchAll(/\]\((https?:\/\/[^\s)]+)\)/g)) out.push(m[1]);
  return out;
}

/**
 * Sources ordered by where the answer first links to them, so the list's
 * numbers follow the reading order (and an answer's own "[1]", "[2]" markers,
 * which usually number sources in that order). Sources the prose never links
 * keep their order, after the linked ones.
 */
export function orderByFirstLink<T extends { url: string }>(sources: T[], markdown: string): T[] {
  const firstSeen = new Map<string, number>();
  linkedUrls(markdown).forEach((url, i) => {
    const key = urlKey(url);
    if (!firstSeen.has(key)) firstSeen.set(key, i);
  });
  return sources
    .map((s, i) => ({ s, i, at: firstSeen.get(urlKey(s.url)) ?? Number.POSITIVE_INFINITY }))
    .sort((a, b) => a.at - b.at || a.i - b.i)
    .map(({ s }) => s);
}

// "I'll search for current information on this topic." and the like: the
// model narrating its web search, not part of its answer.
const PREAMBLE =
  /^(?:I'll|I will|Let me|I'm going to|I am going to)\s+(?:(?:also|now|first|quickly)\s+)?(?:search|look|check|find|gather|research|pull)\b[^\n]{0,140}?[.:!…]\s*(?:\n+|$)/i;

/** The answer as shown: leading search narration dropped. The stored answer is unchanged. */
export function stripSearchPreamble(text: string): string {
  let out = text;
  // A model sometimes narrates twice ("Let me search… I'll also check…").
  for (let i = 0; i < 2; i++) {
    const next = out.replace(PREAMBLE, "");
    if (next === out) break;
    out = next.trimStart();
  }
  return out.length > 0 ? out : text;
}
