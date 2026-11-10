/**
 * The event watcher (task 4.7, PROJECT-PLAN §4D). A Railway cron service runs
 * scripts/event-watcher.ts every hour; each run does, in order:
 *
 * 1. Known dates (once a week): official election and legislative-session
 *    dates for each tracked geography and federal, next 12 months, stored as
 *    `scheduled` events and refreshed when a date moves.
 * 2. Scan (once a day, from SCAN_HOUR_UTC): web search for events in the
 *    approved categories (all but new_model, which is the model watcher's).
 *    New ones are logged with their source; repeats of a logged story are not.
 * 3. Schedule: each pending event whose snapshot is due within 3 days gets a
 *    slot about 24h after it happened, sharing a slot with another event of
 *    the same item within 24h. At most 2 event snapshots per item per week;
 *    the rest are logged as ignored with the reason. No approval needed.
 * 4. Run due snapshots (Run kind `event`, linked to its events), each capped
 *    at EVENT_SNAPSHOT_CAP_USD, compared with the item's previous snapshot.
 *
 * Every unit of work is claimed in WatcherJob first, so the run Railway starts
 * on each deploy repeats nothing. Each stage's failures are caught, logged and
 * returned for error reporting; one failing never stops the others.
 */
import { Prisma, type EventCategory, type PrismaClient } from "@/app/generated/prisma/client";
import { compareRuns, runSnapshot, type RunSnapshotOptions, type RunSnapshotResult, type SnapshotStats } from "@/lib/snapshots";
import { STALE_RUNNING_MS, weekStart } from "@/lib/worker/weekly";
import { afterSnapshot } from "@/lib/alerts";
import { claimJob, finishJob } from "./jobs";
import {
  WATCHED_CATEGORIES,
  belowBar,
  dayKey,
  decideSlot,
  dedupeBatch,
  findDuplicate,
  scanGeographies,
  tooOld,
  triggerAtFor,
  type Candidate,
  type KnownEvent,
  type Slot,
  type WatchItemRef,
} from "./rules";
import { knownDateScopes, scanScopes, searchScope, type ScopeResult } from "./scan";

export const DEFAULT_SCAN_CAP_USD = 1;
export const DEFAULT_SNAPSHOT_CAP_USD = 5;
export const DEFAULT_RUN_CAP_USD = 15;
/** The day's scan runs on the first cron run at or after this hour (12:00 UTC = 6am Central in winter). */
export const DEFAULT_SCAN_HOUR_UTC = 12;
/** Pending events are given a slot once their trigger time is this close. */
export const SCHEDULE_HORIZON_MS = 3 * 24 * 3600 * 1000;
const MIN_SNAPSHOT_BUDGET_USD = 1;
const DAY = 24 * 3600 * 1000;

export interface WatcherError {
  stage: "known_dates" | "scan" | "schedule" | "snapshot";
  message: string;
  error?: unknown;
  context?: Record<string, unknown>;
}

export interface EventWatcherOptions {
  now?: Date;
  scanCapUsd?: number;
  snapshotCapUsd?: number;
  runCapUsd?: number;
  scanHourUtc?: number;
  /** Run the scan now even before scanHourUtc (still once a day). */
  forceScan?: boolean;
  /** Which stages to run; unnamed ones are off. Omit to run all. */
  stages?: { knownDates?: boolean; scan?: boolean; schedule?: boolean; snapshots?: boolean };
  /** Swappable for tests. */
  search?: typeof searchScope;
  snapshot?: (db: PrismaClient, watchItemId: string, options: RunSnapshotOptions) => Promise<RunSnapshotResult>;
  compare?: typeof compareRuns;
  alerts?: typeof afterSnapshot;
  snapshotOptions?: Omit<RunSnapshotOptions, "kind" | "maxCostUsd" | "note">;
  log?: (line: string) => void;
}

export interface LoggedEvent {
  title: string;
  category: string;
  occurredAt: string;
  source: string;
  status: "pending" | "ignored";
  items: string[];
  note?: string;
}

export interface StageSummary {
  ran: boolean;
  reason?: string;
  costUsd: number;
  scopes: { scope: string; costUsd: number; searches: number; found: number; dropped: number; error?: string }[];
  logged: LoggedEvent[];
  duplicates: { title: string; of: string }[];
  dropped: { scope: string; title: string; reason: string }[];
  updated?: { title: string; from: string; to: string }[];
}

export interface SnapshotOutcome {
  watchItemId: string;
  name: string;
  triggerAt: string;
  events: string[];
  outcome: "ran" | "deferred" | "skipped" | "failed";
  reason?: string;
  runId?: string;
  status?: string;
  costUsd?: number;
  swings?: number;
  comparedWith?: string;
}

export interface EventWatcherResult {
  knownDates: StageSummary;
  scan: StageSummary;
  scheduled: { title: string; item: string; decision: string; triggerAt?: string }[];
  snapshots: SnapshotOutcome[];
  costUsd: number;
  errors: WatcherError[];
}

const emptyStage = (reason?: string): StageSummary => ({ ran: false, reason, costUsd: 0, scopes: [], logged: [], duplicates: [], dropped: [] });
const WATCHED = [...WATCHED_CATEGORIES] as EventCategory[];

export async function runEventWatcher(db: PrismaClient, options: EventWatcherOptions = {}): Promise<EventWatcherResult> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  // All stages by default; when some are named, only those.
  const stages = options.stages
    ? { knownDates: false, scan: false, schedule: false, snapshots: false, ...options.stages }
    : { knownDates: true, scan: true, schedule: true, snapshots: true };
  const errors: WatcherError[] = [];
  const result: EventWatcherResult = { knownDates: emptyStage("off"), scan: emptyStage("off"), scheduled: [], snapshots: [], costUsd: 0, errors };

  const rows = await db.watchItem.findMany({
    where: { active: true, retiredAt: null },
    orderBy: { createdAt: "asc" },
    include: { subTopics: { where: { retiredAt: null }, select: { name: true } } },
  });
  const items: WatchItemRef[] = rows.map((r) => ({ id: r.id, name: r.name, topic: r.topic, geography: r.geography, subTopics: r.subTopics.map((s) => s.name) }));
  const names = new Map(items.map((i) => [i.id, i.name]));
  const geographies = scanGeographies(items);
  log(`Watch items: ${items.map((i) => i.name).join("; ")}. Geographies: ${geographies.join(", ")}`);

  if (stages.knownDates) {
    result.knownDates = await stage("known_dates", errors, log, () => refreshKnownDates(db, items, geographies, now, options, log, errors), emptyStage);
  }
  if (stages.scan) {
    const hourOk = options.forceScan || now.getUTCHours() >= (options.scanHourUtc ?? DEFAULT_SCAN_HOUR_UTC);
    result.scan = hourOk
      ? await stage("scan", errors, log, () => dailyScan(db, items, geographies, now, options, log, errors), emptyStage)
      : emptyStage(`before ${options.scanHourUtc ?? DEFAULT_SCAN_HOUR_UTC}:00 UTC`);
  }
  if (stages.schedule) {
    result.scheduled = await stage("schedule", errors, log, () => schedulePending(db, now, names, log), () => []);
  }
  if (stages.snapshots) {
    result.snapshots = await stage("snapshot", errors, log, () => runDueSnapshots(db, now, names, options, log, errors), () => []);
  }
  result.costUsd = result.knownDates.costUsd + result.scan.costUsd + result.snapshots.reduce((n, s) => n + (s.costUsd ?? 0), 0);
  return result;
}

async function stage<T>(name: WatcherError["stage"], errors: WatcherError[], log: (l: string) => void, fn: () => Promise<T>, onError: (reason: string) => T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = `${name} failed: ${err instanceof Error ? err.message : String(err)}`;
    errors.push({ stage: name, message, error: err });
    log(message);
    return onError(message);
  }
}

/** Events the watcher compares new finds against: the last 30 days and the next year's calendar. */
async function knownEvents(db: PrismaClient, now: Date): Promise<KnownEvent[]> {
  return db.event.findMany({
    where: { category: { in: WATCHED }, occurredAt: { gte: new Date(now.getTime() - 30 * DAY) } },
    orderBy: { occurredAt: "asc" },
    select: { id: true, title: true, category: true, geography: true, occurredAt: true, sourceUrl: true, watchItemId: true },
  });
}

/** Run each scope's search under a shared cap; one scope failing doesn't stop the others. */
async function searchAll(
  scopes: ReturnType<typeof scanScopes>,
  capUsd: number,
  search: typeof searchScope,
  args: Omit<Parameters<typeof searchScope>[1], "client">,
  summary: StageSummary,
  errors: WatcherError[],
  log: (l: string) => void
): Promise<ScopeResult[]> {
  const out: ScopeResult[] = [];
  for (const scope of scopes) {
    if (summary.costUsd >= capUsd) {
      summary.scopes.push({ scope: scope.name, costUsd: 0, searches: 0, found: 0, dropped: 0, error: `skipped: cap $${capUsd} reached` });
      errors.push({ stage: scope.kind, message: `${scope.kind} cap $${capUsd} reached before scope ${scope.name}`, context: { spent: summary.costUsd } });
      continue;
    }
    try {
      const r = await search(scope, args);
      summary.costUsd += r.costUsd;
      summary.scopes.push({ scope: scope.name, costUsd: r.costUsd, searches: r.searches, found: r.candidates.length, dropped: r.dropped.length });
      summary.dropped.push(...r.dropped.map((d) => ({ scope: scope.name, ...d })));
      log(`  ${scope.kind} ${scope.name}: ${r.candidates.length} found, ${r.dropped.length} dropped, ${r.searches} searches, $${r.costUsd.toFixed(4)}`);
      out.push(r);
    } catch (err) {
      const message = `${scope.kind} scope ${scope.name} failed: ${err instanceof Error ? err.message : String(err)}`;
      summary.scopes.push({ scope: scope.name, costUsd: 0, searches: 0, found: 0, dropped: 0, error: message });
      errors.push({ stage: scope.kind, message, error: err });
      log(`  ${message}`);
    }
  }
  return out;
}

async function refreshKnownDates(
  db: PrismaClient,
  items: WatchItemRef[],
  geographies: string[],
  now: Date,
  options: EventWatcherOptions,
  log: (l: string) => void,
  errors: WatcherError[]
): Promise<StageSummary> {
  // Once a week, plus whenever a new geography appears (it's part of the key).
  const key = `events:known-dates:${dayKey(weekStart(now))}:${geographies.join("|").toLowerCase()}`;
  const claim = await claimJob(db, key, "known_dates", now);
  if (!claim.claimed) return emptyStage(`known dates: ${claim.reason}`);
  const summary: StageSummary = { ...emptyStage(), ran: true, updated: [] };
  const firstError = errors.length;
  const stageNote = () => errors.slice(firstError).map((e) => e.message).join("; ") || undefined;
  try {
    const known = await db.event.findMany({
      where: { scheduled: true, category: { in: ["election", "legislative_session"] }, occurredAt: { gte: new Date(now.getTime() - 7 * DAY) } },
      orderBy: { occurredAt: "asc" },
      select: { id: true, title: true, category: true, geography: true, occurredAt: true, sourceUrl: true, watchItemId: true, runId: true, status: true },
    });
    const scopes = knownDateScopes(items, geographies);
    const results = await searchAll(scopes, options.scanCapUsd ?? DEFAULT_SCAN_CAP_USD, options.search ?? searchScope, { today: now, known }, summary, errors, log);
    for (const r of results) {
      for (const c of dedupeBatch(r.candidates)) {
        if (c.occurredAt.getTime() < now.getTime() - DAY) {
          summary.dropped.push({ scope: r.scope, title: c.title, reason: `in the past (${dayKey(c.occurredAt)})` });
          continue;
        }
        const dup = findDuplicate(c, known);
        if (dup) {
          // Refresh a date that moved, as long as its snapshot hasn't been set or run.
          const moved = Math.abs(dup.occurredAt.getTime() - c.occurredAt.getTime()) >= DAY;
          if (moved && c.duplicateOf) {
            const same = known.filter((k) => k.title === dup.title && dayKey(k.occurredAt) === dayKey(dup.occurredAt) && !k.runId && k.status === "pending");
            if (same.length) {
              await db.event.updateMany({
                where: { id: { in: same.map((k) => k.id) } },
                data: { occurredAt: c.occurredAt, triggerAt: triggerAtFor(c.occurredAt), sourceUrl: c.sourceUrl, sourceName: c.sourceName, note: `date refreshed from ${dayKey(dup.occurredAt)}` },
              });
              summary.updated!.push({ title: dup.title, from: dayKey(dup.occurredAt), to: dayKey(c.occurredAt) });
              continue;
            }
          }
          summary.duplicates.push({ title: c.title, of: dup.id });
          continue;
        }
        const created = await logCandidate(db, c, { scheduled: true, status: "pending" }, summary);
        known.push(...created.map((e) => ({ ...e, runId: null, status: "pending" as const })));
      }
    }
    const allFailed = scopes.length > 0 && results.length === 0;
    await finishJob(db, key, allFailed ? "failed" : "complete", { costUsd: summary.costUsd, stats: summary, note: stageNote() });
  } catch (err) {
    await finishJob(db, key, "failed", { costUsd: summary.costUsd, note: String(err) }).catch(() => {});
    throw err;
  }
  log(`Known dates: ${summary.logged.length} new, ${summary.updated!.length} moved, ${summary.duplicates.length} already logged, $${summary.costUsd.toFixed(4)}`);
  return summary;
}

async function dailyScan(
  db: PrismaClient,
  items: WatchItemRef[],
  geographies: string[],
  now: Date,
  options: EventWatcherOptions,
  log: (l: string) => void,
  errors: WatcherError[]
): Promise<StageSummary> {
  const key = `events:scan:${dayKey(now)}`;
  const claim = await claimJob(db, key, "scan", now);
  if (!claim.claimed) return emptyStage(`scan: ${claim.reason}`);
  const summary: StageSummary = { ...emptyStage(), ran: true };
  const firstError = errors.length;
  const stageNote = () => errors.slice(firstError).map((e) => e.message).join("; ") || undefined;
  try {
    // Look back to a day before the last finished scan: at least 2 days, at most 4.
    const last = await db.watcherJob.findFirst({ where: { kind: "scan", status: "complete", key: { not: key } }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
    const floor = now.getTime() - 4 * DAY;
    const since = new Date(Math.max(floor, Math.min(now.getTime() - 2 * DAY, (last?.startedAt.getTime() ?? floor) - DAY)));
    const known = await knownEvents(db, now);
    const scopes = scanScopes(items, geographies);
    const results = await searchAll(scopes, options.scanCapUsd ?? DEFAULT_SCAN_CAP_USD, options.search ?? searchScope, { today: now, since, known }, summary, errors, log);
    const found = dedupeBatch(results.flatMap((r) => r.candidates));
    for (const c of found) {
      const dup = findDuplicate(c, known);
      if (dup) {
        summary.duplicates.push({ title: c.title, of: dup.id });
        continue;
      }
      const why = belowBar(c) ?? tooOld(c.occurredAt, now);
      const created = await logCandidate(db, c, why ? { scheduled: false, status: "ignored", note: why } : { scheduled: false, status: "pending" }, summary);
      known.push(...created);
    }
    const allFailed = scopes.length > 0 && results.length === 0;
    await finishJob(db, key, allFailed ? "failed" : "complete", { costUsd: summary.costUsd, stats: { since, ...summary }, note: stageNote() });
  } catch (err) {
    await finishJob(db, key, "failed", { costUsd: summary.costUsd, note: String(err) }).catch(() => {});
    throw err;
  }
  log(`Scan: ${summary.logged.length} new events (${summary.logged.filter((e) => e.status === "ignored").length} below the bar), ${summary.duplicates.length} repeats of logged stories, $${summary.costUsd.toFixed(4)}`);
  return summary;
}

/** Log a found event: one Event row per watch item it bears on. */
async function logCandidate(
  db: PrismaClient,
  c: Candidate,
  as: { scheduled: boolean; status: "pending" | "ignored"; note?: string },
  summary: StageSummary
): Promise<KnownEvent[]> {
  const created: KnownEvent[] = [];
  for (const watchItemId of c.watchItemIds) {
    const e = await db.event.create({
      data: {
        category: c.category,
        status: as.status,
        title: c.title,
        summary: c.why || null,
        sourceUrl: c.sourceUrl,
        sourceName: c.sourceName,
        scheduled: as.scheduled,
        occurredAt: c.occurredAt,
        triggerAt: as.status === "pending" ? triggerAtFor(c.occurredAt) : null,
        geography: c.geography,
        watchItemId,
        note: as.note ?? null,
      },
      select: { id: true, title: true, category: true, geography: true, occurredAt: true, sourceUrl: true, watchItemId: true },
    });
    created.push(e);
  }
  summary.logged.push({
    title: c.title,
    category: c.category,
    occurredAt: c.occurredAt.toISOString(),
    source: `${c.sourceName} <${c.sourceUrl}>`,
    status: as.status,
    items: c.watchItemIds,
    ...(as.note ? { note: as.note } : {}),
  });
  return created;
}

/** Give each pending event that's due soon a snapshot slot, or log it as ignored. */
async function schedulePending(db: PrismaClient, now: Date, names: Map<string, string>, log: (l: string) => void) {
  const out: EventWatcherResult["scheduled"] = [];
  const pending = await db.event.findMany({
    where: { status: "pending", category: { in: WATCHED }, triggerAt: { lte: new Date(now.getTime() + SCHEDULE_HORIZON_MS) } },
    orderBy: [{ triggerAt: "asc" }, { detectedAt: "asc" }],
  });
  for (const e of pending) {
    const item = e.watchItemId ? names.get(e.watchItemId) : undefined;
    if (!e.watchItemId || !item) {
      await db.event.update({ where: { id: e.id }, data: { status: "ignored", note: "no active watch item" } });
      out.push({ title: e.title, item: e.watchItemId ?? "(none)", decision: "ignored: no active watch item" });
      continue;
    }
    const around = weekStart(e.triggerAt!);
    const approved = await db.event.findMany({
      where: {
        watchItemId: e.watchItemId,
        status: "approved",
        category: { in: WATCHED },
        triggerAt: { gte: new Date(around.getTime() - DAY), lt: new Date(around.getTime() + 8 * DAY) },
      },
      select: { triggerAt: true, runId: true },
    });
    const slots = new Map<number, Slot>();
    for (const a of approved) {
      const t = a.triggerAt!.getTime();
      const s = slots.get(t) ?? { triggerAt: a.triggerAt!, started: false };
      s.started ||= !!a.runId;
      slots.set(t, s);
    }
    // A slot whose snapshot job already started is used too.
    for (const s of slots.values()) {
      if (!s.started) s.started = !!(await db.watcherJob.findUnique({ where: { key: snapshotKey(e.watchItemId, s.triggerAt) }, select: { id: true } }));
    }
    const d = decideSlot(e.triggerAt!, [...slots.values()]);
    if (d.kind === "capped") {
      await db.event.update({ where: { id: e.id }, data: { status: "ignored", note: d.reason } });
      out.push({ title: e.title, item, decision: `ignored: ${d.reason}` });
      log(`  ${item}: "${e.title}" ignored, ${d.reason}`);
      continue;
    }
    if (d.kind === "join" && d.moveFrom) {
      await db.event.updateMany({
        where: { watchItemId: e.watchItemId, status: "approved", runId: null, triggerAt: d.moveFrom, category: { in: WATCHED } },
        data: { triggerAt: d.triggerAt },
      });
    }
    await db.event.update({
      where: { id: e.id },
      data: { status: "approved", triggerAt: d.triggerAt, note: d.kind === "join" ? "shares a snapshot with another event within 24h" : null },
    });
    out.push({ title: e.title, item, decision: d.kind === "join" ? "approved, shares a slot" : "approved", triggerAt: d.triggerAt.toISOString() });
    log(`  ${item}: "${e.title}" approved, snapshot at ${d.triggerAt.toISOString()} (${e.sourceName ?? "?"} <${e.sourceUrl ?? "?"}>)`);
  }
  return out;
}

export function snapshotKey(watchItemId: string, triggerAt: Date): string {
  return `events:snapshot:${watchItemId}:${triggerAt.toISOString()}`;
}

async function runDueSnapshots(
  db: PrismaClient,
  now: Date,
  names: Map<string, string>,
  options: EventWatcherOptions,
  log: (l: string) => void,
  errors: WatcherError[]
): Promise<SnapshotOutcome[]> {
  const snapshotCap = options.snapshotCapUsd ?? DEFAULT_SNAPSHOT_CAP_USD;
  const runCap = options.runCapUsd ?? DEFAULT_RUN_CAP_USD;
  const snapshot = options.snapshot ?? runSnapshot;
  const compare = options.compare ?? compareRuns;
  const due = await db.event.findMany({
    where: { status: "approved", runId: null, category: { in: WATCHED }, triggerAt: { lte: now }, watchItemId: { not: null } },
    orderBy: { triggerAt: "asc" },
  });
  const groups = new Map<string, typeof due>();
  for (const e of due) {
    const k = snapshotKey(e.watchItemId!, e.triggerAt!);
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  const out: SnapshotOutcome[] = [];
  let spent = 0;
  for (const [key, events] of groups) {
    const watchItemId = events[0].watchItemId!;
    const triggerAt = events[0].triggerAt!;
    const base = { watchItemId, name: names.get(watchItemId) ?? watchItemId, triggerAt: triggerAt.toISOString(), events: events.map((e) => e.title) };
    if (!names.has(watchItemId)) {
      await db.event.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { status: "ignored", note: "watch item no longer active" } });
      out.push({ ...base, outcome: "skipped", reason: "watch item no longer active" });
      continue;
    }
    const left = runCap - spent;
    if (left < MIN_SNAPSHOT_BUDGET_USD) {
      out.push({ ...base, outcome: "deferred", reason: `run cap $${runCap} reached; next run` });
      continue;
    }
    const busy = await db.run.findFirst({
      where: { watchItemId, status: "running", startedAt: { gte: new Date(now.getTime() - STALE_RUNNING_MS) } },
      select: { id: true, kind: true },
    });
    if (busy) {
      out.push({ ...base, outcome: "deferred", reason: `a ${busy.kind} snapshot is running (${busy.id}); next run` });
      continue;
    }
    const claim = await claimJob(db, key, "snapshot", now);
    if (!claim.claimed) {
      if (claim.reason.startsWith("gave up")) {
        await db.event.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { status: "ignored", note: `snapshot ${claim.reason}` } });
      }
      out.push({ ...base, outcome: "skipped", reason: claim.reason });
      continue;
    }
    const started = new Date();
    try {
      const result = await snapshot(db, watchItemId, {
        ...options.snapshotOptions,
        kind: "event",
        maxCostUsd: Math.min(snapshotCap, left),
        note: `event watcher: ${events.map((e) => e.title).join(" | ")}`.slice(0, 1000),
      });
      spent += result.costUsd;
      await db.event.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { runId: result.runId } });
      const outcome: SnapshotOutcome = { ...base, outcome: "ran", runId: result.runId, status: result.pipeline.status, costUsd: result.costUsd };
      const previous = await db.run.findFirst({
        where: { watchItemId, id: { not: result.runId }, status: { in: ["complete", "partial"] }, stats: { not: Prisma.AnyNull }, startedAt: { lt: started } },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
      let stats: SnapshotStats = result.stats;
      if (previous) {
        try {
          const comparison = await compare(db, previous.id, result.runId);
          stats = { ...stats, comparison: { againstRunId: previous.id, ...comparison } };
          outcome.comparedWith = previous.id;
          outcome.swings = comparison.swings.length;
        } catch (err) {
          errors.push({ stage: "snapshot", message: `comparison of ${result.runId} against ${previous.id} failed: ${String(err)}`, error: err, context: { runId: result.runId } });
        }
      }
      await db.run.update({ where: { id: result.runId }, data: { stats: JSON.parse(JSON.stringify(stats)) } });
      await (options.alerts ?? afterSnapshot)(db, result.runId, { log: (l) => log(`  ${base.name}: ${l}`) });
      await finishJob(db, key, "complete", { costUsd: result.costUsd, stats: { runId: result.runId, status: result.pipeline.status, swings: outcome.swings } });
      if (result.pipeline.status !== "complete" || result.stats.stoppedAtCapUsd) {
        errors.push({
          stage: "snapshot",
          message: `Event snapshot for ${base.name} finished ${result.pipeline.status}${result.stats.stoppedAtCapUsd ? ` (stopped at $${result.stats.stoppedAtCapUsd} cap)` : ""}`,
          context: { runId: result.runId, costUsd: result.costUsd, level: "warning" },
        });
      }
      out.push(outcome);
      log(`  ${base.name}: event snapshot ${result.pipeline.status} (run ${result.runId}), $${result.costUsd.toFixed(2)}${outcome.comparedWith ? `, ${outcome.swings} swings vs ${outcome.comparedWith}` : ""}`);
    } catch (err) {
      const failedRun = await db.run.findFirst({ where: { watchItemId, kind: "event", startedAt: { gte: started } }, orderBy: { startedAt: "desc" }, select: { id: true } });
      if (failedRun) {
        await db.run.updateMany({ where: { id: failedRun.id, status: "running" }, data: { status: "failed", finishedAt: new Date(), note: `event watcher: ${String(err)}`.slice(0, 1000) } }).catch(() => {});
      }
      const note = `snapshot attempt ${claim.attempt} failed${failedRun ? ` (run ${failedRun.id})` : ""}: ${String(err)}`.slice(0, 1000);
      await db.event.updateMany({ where: { id: { in: events.map((e) => e.id) } }, data: { note } }).catch(() => {});
      await finishJob(db, key, "failed", { note }).catch(() => {});
      errors.push({ stage: "snapshot", message: `Event snapshot failed for ${base.name}: ${String(err)}`, error: err, context: { watchItemId, runId: failedRun?.id, attempt: claim.attempt } });
      out.push({ ...base, outcome: "failed", reason: String(err), runId: failedRun?.id });
      log(`  ${base.name}: event snapshot FAILED: ${String(err)}`);
    }
  }
  return out;
}
