/**
 * Event watcher rules (task 4.7, PROJECT-PLAN §4D): pure functions, no I/O,
 * so each rule is tested on its own.
 *
 * - Geographies come from the active watch items, plus federal.
 * - The model's output is parsed strictly; anything malformed is dropped.
 * - Hearings never count; routine groundbreakings and openings don't either.
 * - The same story from different outlets counts once (dedup).
 * - An event's snapshot runs about 24h after it happened.
 * - At most 2 event snapshots per watch item per week (Monday 00:00 UTC).
 */
import type { EventCategory } from "@/app/generated/prisma/client";
import { weekStart } from "@/lib/worker/weekly";

/** Categories this watcher looks for. `new_model` belongs to the model watcher (task 4.5). */
export const WATCHED_CATEGORIES = ["model_policy", "crawler_change", "election", "legislative_session", "major_news"] as const;
export type WatchedCategory = (typeof WATCHED_CATEGORIES)[number];

export const FEDERAL = "federal";
/** An event snapshot runs this long after the event. */
export const TRIGGER_DELAY_MS = 24 * 3600 * 1000;
/** Events with only a date are placed at 18:00 UTC (midday in Texas and New Mexico). */
export const DATE_ONLY_HOUR_UTC = 18;
/** Event snapshots allowed per watch item per week. */
export const WEEKLY_EVENT_SNAPSHOTS = 2;
/** Events of one item whose trigger times are this close share one snapshot. */
export const SLOT_MERGE_MS = 24 * 3600 * 1000;
/** An unscheduled event found this long after it happened is too old to trigger. */
export const MAX_EVENT_AGE_MS = 4 * 24 * 3600 * 1000;

export interface WatchItemRef {
  id: string;
  name: string;
  topic: string;
  geography: string | null;
  subTopics: string[];
}

/** Geographies to scan: each active item's geography (deduped, case-insensitive), then federal. */
export function scanGeographies(items: Pick<WatchItemRef, "geography">[]): string[] {
  const seen = new Map<string, string>();
  for (const i of items) {
    const g = i.geography?.trim();
    if (g && g.toLowerCase() !== FEDERAL && !seen.has(g.toLowerCase())) seen.set(g.toLowerCase(), g);
  }
  return [...seen.values(), FEDERAL];
}

/** Items an event in `geography` can affect: that geography's items; federal and AI-wide events affect all. */
export function itemsForGeography<T extends Pick<WatchItemRef, "geography">>(items: T[], geography: string | null): T[] {
  if (!geography || geography.toLowerCase() === FEDERAL) return items;
  return items.filter((i) => i.geography?.toLowerCase() === geography.toLowerCase());
}

/** One event as the model reports it. */
export interface Candidate {
  title: string;
  category: WatchedCategory;
  /** Watch item ids it bears on (mapped from the refs the model saw). */
  watchItemIds: string[];
  geography: string | null;
  occurredAt: Date;
  /** true when the model gave only a date. */
  dateOnly: boolean;
  sourceUrl: string;
  sourceName: string;
  why: string;
  /** Existing event id the model says this repeats. */
  duplicateOf: string | null;
}

/** The structured output every scan call must return. */
export const EVENTS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["events"],
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "category", "watchItems", "geography", "occurredOn", "occurredTime", "sourceUrl", "sourceName", "whyItClearsTheBar", "duplicateOf"],
        properties: {
          title: { type: "string", description: "Plain headline, under 120 characters." },
          category: { type: "string", enum: [...WATCHED_CATEGORIES] },
          watchItems: { type: "array", items: { type: "string" }, description: "Refs (W1, W2…) of the watch items it is directly about." },
          geography: { type: ["string", "null"], description: "The state it happened in, 'federal', or null for AI-company events." },
          occurredOn: { type: "string", description: "YYYY-MM-DD it happened (or will)." },
          occurredTime: { type: ["string", "null"], description: "HH:MM in UTC if known, else null." },
          sourceUrl: { type: "string", description: "URL of the best source: the official page, or the outlet that broke it." },
          sourceName: { type: "string", description: "Name of that source." },
          whyItClearsTheBar: { type: "string", description: "One sentence on why this is big enough to change what an AI says about the watch item." },
          duplicateOf: { type: ["string", "null"], description: "Ref (E1, E2…) of an already-logged event this is the same story as, else null." },
        },
      },
    },
  },
} as const;

/**
 * Parse one scan response. `itemRefs` and `eventRefs` map the short refs the
 * model saw (W1, E1) back to ids. Entries with a bad category, date, URL or
 * no watch item are dropped and reported in `dropped`.
 */
export function parseCandidates(
  raw: unknown,
  itemRefs: Map<string, string>,
  eventRefs: Map<string, string> = new Map()
): { candidates: Candidate[]; dropped: { title: string; reason: string }[] } {
  const candidates: Candidate[] = [];
  const dropped: { title: string; reason: string }[] = [];
  const list = raw && typeof raw === "object" && Array.isArray((raw as { events?: unknown }).events) ? (raw as { events: unknown[] }).events : [];
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const r = e as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title.trim().slice(0, 300) : "";
    const drop = (reason: string) => dropped.push({ title: title || "(no title)", reason });
    if (!title) {
      drop("no title");
      continue;
    }
    if (!WATCHED_CATEGORIES.includes(r.category as WatchedCategory)) {
      drop(`category ${String(r.category)} isn't watched here`);
      continue;
    }
    const occurred = parseOccurred(r.occurredOn, r.occurredTime);
    if (!occurred) {
      drop(`bad date ${String(r.occurredOn)}`);
      continue;
    }
    const sourceUrl = typeof r.sourceUrl === "string" ? cleanUrl(r.sourceUrl) : null;
    if (!sourceUrl) {
      drop(`bad source URL ${String(r.sourceUrl)}`);
      continue;
    }
    const refs = Array.isArray(r.watchItems) ? r.watchItems : [];
    const watchItemIds = [...new Set(refs.flatMap((x) => (typeof x === "string" && itemRefs.has(x.trim()) ? [itemRefs.get(x.trim())!] : [])))];
    if (!watchItemIds.length) {
      drop("no known watch item");
      continue;
    }
    const geography = typeof r.geography === "string" && r.geography.trim() ? r.geography.trim() : null;
    const dup = typeof r.duplicateOf === "string" ? (eventRefs.get(r.duplicateOf.trim()) ?? null) : null;
    candidates.push({
      title,
      category: r.category as WatchedCategory,
      watchItemIds,
      geography,
      occurredAt: occurred.at,
      dateOnly: occurred.dateOnly,
      sourceUrl,
      sourceName: typeof r.sourceName === "string" && r.sourceName.trim() ? r.sourceName.trim().slice(0, 200) : hostOf(sourceUrl),
      why: typeof r.whyItClearsTheBar === "string" ? r.whyItClearsTheBar.trim().slice(0, 1000) : "",
      duplicateOf: dup,
    });
  }
  return { candidates, dropped };
}

function parseOccurred(on: unknown, time: unknown): { at: Date; dateOnly: boolean } | null {
  if (typeof on !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(on.trim())) return null;
  const [y, m, d] = on.trim().split("-").map(Number);
  const t = typeof time === "string" ? /^(\d{1,2}):(\d{2})/.exec(time.trim()) : null;
  const hh = t ? Number(t[1]) : DATE_ONLY_HOUR_UTC;
  const mm = t ? Number(t[2]) : 0;
  if (hh > 23 || mm > 59) return null;
  const at = new Date(Date.UTC(y, m - 1, d, hh, mm));
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null;
  return { at, dateOnly: !t };
}

/** An http(s) URL with web-search tracking params removed, or null. */
export function cleanUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k);
  u.hash = "";
  return u.toString();
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const HEARING = /\bhearings?\b/i;
const ROUTINE = /\b(ground-?breaking|breaks? ground|broke ground|ribbon[- ]cutting|grand opening|opens? (its )?(doors|new)|officially opens?)\b/i;

/** Why a candidate fails the bar on rules alone (hearings, routine openings), or null. */
export function belowBar(c: Pick<Candidate, "title" | "why" | "category">): string | null {
  if (c.category !== "major_news") return null;
  if (HEARING.test(c.title)) return "hearings never count";
  if (ROUTINE.test(c.title)) return "routine groundbreakings and openings don't count";
  return null;
}

/** Why an unscheduled event is too old to trigger, or null. */
export function tooOld(occurredAt: Date, now: Date): string | null {
  return now.getTime() - occurredAt.getTime() > MAX_EVENT_AGE_MS ? `happened ${occurredAt.toISOString().slice(0, 10)}, more than 4 days before it was found` : null;
}

/** When an event's snapshot should run: about 24h after it happened. */
export function triggerAtFor(occurredAt: Date): Date {
  return new Date(occurredAt.getTime() + TRIGGER_DELAY_MS);
}

// ---- Dedup ---------------------------------------------------------------

const STOP = new Set(
  "a an and the of in on for to at by with from as is are was were be it its this that new over after into says say said will would could about than more texas new mexico state".split(" ")
);

/** Lowercase word set of a title, without stop words. */
export function titleWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[’']/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w))
  );
}

export function similarity(a: string, b: string): number {
  const A = titleWords(a);
  const B = titleWords(b);
  if (!A.size || !B.size) return 0;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size);
}

export interface KnownEvent {
  id: string;
  title: string;
  category: EventCategory;
  geography: string | null;
  occurredAt: Date;
  sourceUrl: string | null;
  watchItemId: string | null;
}

/** Same-story bar: share of the shorter title's words. */
export const SAME_STORY = 0.6;
/** Stories more than this far apart in time are different stories. */
export const SAME_STORY_WINDOW_MS = 4 * 24 * 3600 * 1000;
/** Calendar events (elections, sessions) in one geography this close are the same date. */
export const SAME_DATE_WINDOW_MS = 2 * 24 * 3600 * 1000;

/**
 * The known event this candidate repeats, or null. Same story means: the
 * model said so; or the same source URL; or, within 4 days, a title sharing
 * most of its words in the same category; or, for elections and sessions,
 * the same category and geography within 2 days.
 */
export function findDuplicate(c: Omit<Candidate, "watchItemIds"> & { watchItemIds?: string[] }, known: KnownEvent[]): KnownEvent | null {
  if (c.duplicateOf) {
    const hit = known.find((k) => k.id === c.duplicateOf);
    if (hit) return hit;
  }
  for (const k of known) {
    if (k.sourceUrl && k.sourceUrl === c.sourceUrl) return k;
  }
  for (const k of known) {
    const gap = Math.abs(k.occurredAt.getTime() - c.occurredAt.getTime());
    if (k.category === c.category && gap <= SAME_STORY_WINDOW_MS && similarity(k.title, c.title) >= SAME_STORY) return k;
    if (
      (c.category === "election" || c.category === "legislative_session") &&
      k.category === c.category &&
      gap <= SAME_DATE_WINDOW_MS &&
      (k.geography ?? FEDERAL).toLowerCase() === (c.geography ?? FEDERAL).toLowerCase()
    )
      return k;
  }
  return null;
}

/** Drop repeats within one scan (two calls finding the same story); the first kept wins and gains the others' items. */
export function dedupeBatch(cands: Candidate[]): Candidate[] {
  const kept: Candidate[] = [];
  for (const c of cands) {
    const known: KnownEvent[] = kept.map((k, i) => ({ id: String(i), title: k.title, category: k.category, geography: k.geography, occurredAt: k.occurredAt, sourceUrl: k.sourceUrl, watchItemId: null }));
    const dup = findDuplicate({ ...c, duplicateOf: null }, known);
    if (dup) {
      const k = kept[Number(dup.id)];
      k.watchItemIds = [...new Set([...k.watchItemIds, ...c.watchItemIds])];
    } else kept.push({ ...c, watchItemIds: [...c.watchItemIds] });
  }
  return kept;
}

// ---- Weekly cap and slots ------------------------------------------------

/** An approved event-snapshot slot of one watch item: a trigger time, with or without a run yet. */
export interface Slot {
  triggerAt: Date;
  /** Started, finished or failed: the slot is used and can't move. */
  started: boolean;
}

export type SlotDecision =
  | { kind: "join"; triggerAt: Date; moveFrom?: Date }
  | { kind: "new"; triggerAt: Date }
  | { kind: "capped"; reason: string };

/**
 * Where an event's snapshot goes for one watch item, given the item's slots:
 * join a not-yet-started slot within 24h (moving it to the later time, so the
 * snapshot comes ~24h after the last event), else take a new slot if the week
 * of its trigger time has fewer than 2, else it's capped.
 */
export function decideSlot(triggerAt: Date, slots: Slot[]): SlotDecision {
  const open = slots
    .filter((s) => !s.started && Math.abs(s.triggerAt.getTime() - triggerAt.getTime()) <= SLOT_MERGE_MS)
    .sort((a, b) => Math.abs(a.triggerAt.getTime() - triggerAt.getTime()) - Math.abs(b.triggerAt.getTime() - triggerAt.getTime()))[0];
  if (open) {
    return open.triggerAt.getTime() >= triggerAt.getTime()
      ? { kind: "join", triggerAt: open.triggerAt }
      : { kind: "join", triggerAt, moveFrom: open.triggerAt };
  }
  const week = weekStart(triggerAt).getTime();
  const inWeek = new Set(slots.filter((s) => weekStart(s.triggerAt).getTime() === week).map((s) => s.triggerAt.getTime())).size;
  if (inWeek >= WEEKLY_EVENT_SNAPSHOTS) {
    return { kind: "capped", reason: `weekly cap: ${WEEKLY_EVENT_SNAPSHOTS} event snapshots already set for the week of ${new Date(week).toISOString().slice(0, 10)}` };
  }
  return { kind: "new", triggerAt };
}

// ---- Idempotency ---------------------------------------------------------

/**
 * A job still "running" after this long was orphaned and may be taken over.
 * A scan takes ~3 minutes and a snapshot ~6, so 50 minutes is safe. The cron
 * is daily (13:00 UTC), so the next day's run, or one started by hand, retries
 * a job whose container was killed (a push to main redeploys every service and
 * SIGTERMs a running cron).
 */
export const STALE_JOB_MS = 50 * 60 * 1000;
/** Failed jobs are retried at most this many times in all. */
export const MAX_ATTEMPTS = 3;

export interface JobRow {
  status: string;
  attempts: number;
  startedAt: Date;
}

/** Whether a cron run may (re)take a job with this key: "new", "retry", or a reason to skip. */
export function claimDecision(existing: JobRow | null, now: Date): { take: "new" | "retry" } | { skip: string } {
  if (!existing) return { take: "new" };
  if (existing.status === "complete" || existing.status === "skipped") return { skip: `already ${existing.status}` };
  if (existing.attempts >= MAX_ATTEMPTS) return { skip: `gave up after ${existing.attempts} attempts` };
  if (existing.status === "running" && now.getTime() - existing.startedAt.getTime() < STALE_JOB_MS) return { skip: "running in another process" };
  return { take: "retry" };
}

/** UTC calendar day, "2026-11-10". */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
