/**
 * The event watcher end to end against a real Postgres migrated to the
 * current schema, with the web search and the snapshot stubbed (no AI calls).
 * Runs only with TEST_DATABASE_URL set to a local database; CI has none, so
 * it skips. Use a dedicated, freshly migrated database: the worker acts on
 * every event in it, so real ones would be scheduled too.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55447/ate47test npx vitest run tests/event-watcher.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { RunSnapshotOptions, RunSnapshotResult } from "@/lib/snapshots";
import type { Candidate, EventWatcherOptions, Scope, ScopeResult } from "@/lib/watchers/events";

const url = process.env.TEST_DATABASE_URL;
const local = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)("event watcher in Postgres", () => {
  let db: PrismaClient;
  let W: typeof import("@/lib/watchers/events");
  let texas: string[];
  const runIds: string[] = [];
  const day = (iso: string) => new Date(`${iso}T18:00:00Z`);

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = (await import("@/lib/db")).prisma;
    W = await import("@/lib/watchers/events");
    await cleanup();
    const items = await db.watchItem.findMany({ where: { active: true, retiredAt: null, geography: "Texas" }, select: { id: true } });
    texas = items.map((i) => i.id);
  });

  async function cleanup() {
    await db.event.deleteMany({ where: { occurredAt: { gte: new Date("2031-01-01"), lt: new Date("2032-01-01") } } });
    await db.watcherJob.deleteMany({ where: { key: { contains: "2031-" } } });
    if (runIds.length) await db.run.deleteMany({ where: { id: { in: runIds } } });
  }

  afterAll(async () => {
    await cleanup();
    await db?.$disconnect();
  });

  function stubSearch(byScope: Record<string, Partial<Candidate>[]>) {
    const calls: string[] = [];
    const search = async (scope: Scope): Promise<ScopeResult> => {
      calls.push(`${scope.kind}:${scope.name}`);
      const candidates = (byScope[scope.name] ?? []).map(
        (c, i): Candidate => ({
          sourceUrl: `https://example.com/${scope.name}/${(c.title ?? String(i)).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          title: `Story ${i}`,
          category: "major_news",
          watchItemIds: scope.items.map((x) => x.id),
          geography: scope.geography,
          occurredAt: day("2031-03-04"),
          dateOnly: true,
          sourceName: "Example News",
          why: "test",
          duplicateOf: null,
          ...c,
        })
      );
      return { scope: scope.name, kind: scope.kind, candidates, dropped: [], costUsd: 0.02, searches: 2, queries: [], model: "stub" };
    };
    return { search, calls };
  }

  function stubSnapshot(fail = false) {
    const calls: { watchItemId: string; options: RunSnapshotOptions }[] = [];
    const snapshot = async (d: PrismaClient, watchItemId: string, options: RunSnapshotOptions): Promise<RunSnapshotResult> => {
      calls.push({ watchItemId, options });
      const run = await d.run.create({ data: { kind: options.kind!, watchItemId, topic: "test", note: options.note ?? null } });
      runIds.push(run.id);
      if (fail) throw new Error("provider down");
      await d.run.update({ where: { id: run.id }, data: { status: "complete", finishedAt: new Date(), costUsd: 4.5 } });
      return { runId: run.id, costUsd: 4.5, pipeline: { status: "complete", answers: [] }, stats: { agreement: { totals: {} } } } as unknown as RunSnapshotResult;
    };
    return { snapshot, calls };
  }

  const base = (now: Date, extra: Partial<EventWatcherOptions> = {}): EventWatcherOptions => ({
    now,
    stages: { knownDates: false, scan: true, schedule: true, snapshots: true },
    compare: async () => ({ swings: [] }) as never,
    ...extra,
  });

  it("logs found events with their source, once a day, and schedules a snapshot ~24h later", async () => {
    const now = new Date("2031-03-04T20:00:00Z");
    const s = stubSearch({ Texas: [{ title: "Texas governor signs data center grid law" }, { title: "Committee hearing on data center water", sourceUrl: "https://example.com/h" }] });
    const snap = stubSnapshot();
    const r = await W.runEventWatcher(db, base(now, { search: s.search, snapshot: snap.snapshot }));
    expect(r.errors).toEqual([]);
    expect(s.calls).toEqual(["scan:ai", "scan:Texas", "scan:New Mexico", "scan:federal"]);
    expect(r.scan.logged.map((e) => [e.title, e.status, e.note ?? null])).toEqual([
      ["Texas governor signs data center grid law", "pending", null],
      ["Committee hearing on data center water", "ignored", "hearings never count"],
    ]);
    const rows = await db.event.findMany({ where: { title: "Texas governor signs data center grid law" }, orderBy: { watchItemId: "asc" } });
    expect(rows.map((e) => e.watchItemId).sort()).toEqual([...texas].sort());
    expect(rows.every((e) => e.status === "approved" && e.sourceUrl === "https://example.com/Texas/texas-governor-signs-data-center-grid-law" && e.sourceName === "Example News")).toBe(true);
    expect(rows[0].triggerAt?.toISOString()).toBe("2031-03-05T18:00:00.000Z");
    expect(snap.calls).toHaveLength(0); // not due yet

    // A second run the same day (a deploy) searches nothing and logs nothing.
    const again = await W.runEventWatcher(db, base(new Date("2031-03-04T22:00:00Z"), { search: s.search, snapshot: snap.snapshot }));
    expect(again.scan).toMatchObject({ ran: false, reason: "scan: already complete" });
    expect(s.calls).toHaveLength(4);
  });

  it("skips the same story from another outlet the next day", async () => {
    const s = stubSearch({ Texas: [{ title: "Governor signs Texas data center grid law", sourceUrl: "https://other.example/x", occurredAt: day("2031-03-04") }] });
    const r = await W.runEventWatcher(db, base(new Date("2031-03-05T13:00:00Z"), { search: s.search, snapshot: stubSnapshot().snapshot, stages: { scan: true } }));
    expect(r.scan.logged).toEqual([]);
    expect(r.scan.duplicates).toHaveLength(1);
  });

  it("runs the due snapshot once per item, kind event, linked to its event and capped", async () => {
    const snap = stubSnapshot();
    const now = new Date("2031-03-05T19:00:00Z");
    const r = await W.runEventWatcher(db, base(now, { stages: { snapshots: true }, snapshot: snap.snapshot, snapshotCapUsd: 5 }));
    expect(r.snapshots.filter((s) => s.outcome === "ran")).toHaveLength(texas.length);
    expect(snap.calls.every((c) => c.options.kind === "event" && c.options.maxCostUsd === 5)).toBe(true);
    const linked = await db.event.findMany({ where: { title: "Texas governor signs data center grid law" }, include: { run: true } });
    expect(linked.every((e) => e.run?.kind === "event")).toBe(true);

    // Run again: nothing left to do.
    const again = await W.runEventWatcher(db, base(new Date("2031-03-05T20:00:00Z"), { stages: { snapshots: true }, snapshot: snap.snapshot }));
    expect(again.snapshots).toEqual([]);
    expect(snap.calls).toHaveLength(texas.length);
  });

  it("allows 2 event snapshots per item per week and logs the rest as ignored with the reason", async () => {
    // Week of Monday 2031-03-03: one slot used above (03-05). Two more distinct events, >24h apart.
    const s1 = stubSearch({ Texas: [{ title: "Texas PUC adopts large-load rule", occurredAt: day("2031-03-06") }] });
    await W.runEventWatcher(db, base(new Date("2031-03-06T20:00:00Z"), { search: s1.search, stages: { scan: true, schedule: true } }));
    // More than 24h after the second (so it can't share its slot), still inside the week (snapshot Sunday 20:00).
    const s2 = stubSearch({ Texas: [{ title: "ERCOT declares statewide energy emergency", occurredAt: new Date("2031-03-08T20:00:00Z"), dateOnly: false }] });
    const r = await W.runEventWatcher(db, base(new Date("2031-03-08T21:00:00Z"), { search: s2.search, stages: { scan: true, schedule: true } }));
    expect(r.scheduled).toHaveLength(texas.length);
    expect(r.scheduled.every((x) => x.decision.startsWith("ignored: weekly cap"))).toBe(true);
    const third = await db.event.findMany({ where: { title: "ERCOT declares statewide energy emergency" } });
    expect(third).toHaveLength(texas.length);
    expect(third.every((e) => e.status === "ignored" && /weekly cap: 2 event snapshots/.test(e.note ?? ""))).toBe(true);
    const second = await db.event.findMany({ where: { title: "Texas PUC adopts large-load rule" } });
    expect(second).toHaveLength(texas.length);
    expect(second.every((e) => e.status === "approved")).toBe(true);
  });

  it("keeps a failed snapshot retryable and reports it", async () => {
    const failing = stubSnapshot(true);
    const r = await W.runEventWatcher(db, base(new Date("2031-03-07T19:00:00Z"), { stages: { snapshots: true }, snapshot: failing.snapshot }));
    expect(r.snapshots).toHaveLength(texas.length);
    expect(r.snapshots.every((s) => s.outcome === "failed")).toBe(true);
    expect(r.errors.filter((e) => e.stage === "snapshot")).toHaveLength(texas.length);
    const ev = await db.event.findMany({ where: { title: "Texas PUC adopts large-load rule" } });
    expect(ev.every((e) => e.runId === null && /attempt 1 failed/.test(e.note ?? ""))).toBe(true);
    const runs = await db.run.findMany({ where: { id: { in: runIds.slice(-texas.length) } } });
    expect(runs.every((x) => x.status === "failed")).toBe(true);

    const ok = stubSnapshot();
    const retry = await W.runEventWatcher(db, base(new Date("2031-03-07T20:00:00Z"), { stages: { snapshots: true }, snapshot: ok.snapshot }));
    expect(retry.snapshots).toHaveLength(texas.length);
    expect(retry.snapshots.every((s) => s.outcome === "ran")).toBe(true);
  });

  it("releases this process's jobs on SIGTERM without using up an attempt", async () => {
    const key = "events:scan:2031-04-01";
    expect(await W.claimJob(db, key, "scan", new Date("2031-04-01T13:00:00Z"))).toEqual({ claimed: true, attempt: 1 });
    expect(await W.abandonActiveJobs(db, "stopped by SIGTERM", new Date("2031-04-01T12:00:00Z"))).toEqual([key]);
    const row = await db.watcherJob.findUnique({ where: { key } });
    expect(row).toMatchObject({ status: "failed", attempts: 0, note: "stopped by SIGTERM" });
    expect(await W.claimJob(db, key, "scan", new Date("2031-04-01T14:00:00Z"))).toEqual({ claimed: true, attempt: 1 });
    await W.finishJob(db, key, "complete");
    expect(await W.abandonActiveJobs(db, "again", new Date())).toEqual([]);
  });
});
