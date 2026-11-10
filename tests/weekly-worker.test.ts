import { describe, expect, it } from "vitest";
import type { PrismaClient, RunStatus } from "@/app/generated/prisma/client";
import type { RunSnapshotOptions, RunSnapshotResult } from "@/lib/snapshots";
import { STALE_RUNNING_MS, capFromEnv, runWeekly, weekStart, weeklySkipReason, type ExistingRun } from "@/lib/worker/weekly";

describe("weekStart", () => {
  it("is Monday 00:00 UTC of the same week", () => {
    expect(weekStart(new Date("2026-11-09T05:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z"); // Monday
    expect(weekStart(new Date("2026-11-15T23:59:59Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z"); // Sunday
    expect(weekStart(new Date("2026-11-11T12:00:00Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z"); // Wednesday
    expect(weekStart(new Date("2026-11-16T00:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("puts the cron's Monday 05:00 UTC run in a new week from the one before", () => {
    const a = weekStart(new Date("2026-11-16T05:00:00Z"));
    const b = weekStart(new Date("2026-11-23T05:00:00Z"));
    expect(b.getTime() - a.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it("handles a year boundary", () => {
    expect(weekStart(new Date("2027-01-01T10:00:00Z")).toISOString()).toBe("2026-12-28T00:00:00.000Z");
  });
});

describe("weeklySkipReason", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const run = (status: RunStatus, startedAt: string): ExistingRun => ({ id: `r-${status}`, status, startedAt: new Date(startedAt) });

  it("runs when nothing ran this week", () => {
    expect(weeklySkipReason([], now)).toBeNull();
    expect(weeklySkipReason([run("complete", "2026-11-08T23:00:00Z")], now)).toBeNull(); // last week
  });

  it("skips after a complete or partial snapshot this week", () => {
    expect(weeklySkipReason([run("complete", "2026-11-09T05:00:00Z")], now)).toMatch(/complete/);
    expect(weeklySkipReason([run("partial", "2026-11-10T05:00:00Z")], now)).toMatch(/partial/);
  });

  it("retries after a failed one", () => {
    expect(weeklySkipReason([run("failed", "2026-11-09T05:00:00Z")], now)).toBeNull();
  });

  it("skips while one is running, but not once it's stale", () => {
    expect(weeklySkipReason([run("running", new Date(now.getTime() - 60_000).toISOString())], now)).toMatch(/running/);
    expect(weeklySkipReason([run("running", new Date(now.getTime() - STALE_RUNNING_MS - 1).toISOString())], now)).toBeNull();
  });
});

describe("capFromEnv", () => {
  it("uses the default when unset or blank", () => {
    expect(capFromEnv(undefined, 15)).toBe(15);
    expect(capFromEnv(" ", 15)).toBe(15);
  });
  it("reads a dollar amount", () => expect(capFromEnv("12.5", 15)).toBe(12.5));
  it("refuses nonsense rather than running uncapped", () => {
    expect(() => capFromEnv("abc", 15)).toThrow();
    expect(() => capFromEnv("0", 15)).toThrow();
    expect(() => capFromEnv("-3", 15)).toThrow();
  });
});

/** Just enough of PrismaClient for runWeekly. */
function fakeDb(
  items: { id: string; name: string }[],
  runs: (ExistingRun & { watchItemId: string; kind?: string; stats?: unknown; costUsd?: number | null })[] = [],
  answerCosts: Record<string, number> = {}
) {
  const updates: { id: string; data: Record<string, unknown> }[] = [];
  const failedMarked: string[] = [];
  const db = {
    watchItem: { findMany: async () => items },
    run: {
      findMany: async ({ where }: { where: { watchItemId?: string; startedAt: { gte: Date } } }) =>
        runs
          .filter((r) => (where.watchItemId == null || r.watchItemId === where.watchItemId) && (r.kind ?? "weekly") === "weekly" && r.startedAt >= where.startedAt.gte)
          .map((r) => ({ costUsd: null, ...r })),
      findFirst: async ({ where }: { where: { watchItemId: string; id: { not: string } } }) =>
        runs
          .filter((r) => r.watchItemId === where.watchItemId && r.id !== where.id.not && r.stats && (r.status === "complete" || r.status === "partial"))
          .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0] ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        return {};
      },
      updateMany: async ({ where }: { where: { watchItemId: string } }) => {
        failedMarked.push(where.watchItemId);
        return { count: 1 };
      },
    },
    answer: { aggregate: async ({ where }: { where: { runId: string } }) => ({ _sum: { costUsd: answerCosts[where.runId] ?? 0 } }) },
    extraction: { aggregate: async () => ({ _sum: { costUsd: 0 } }) },
  };
  return { db: db as unknown as PrismaClient, updates, failedMarked };
}

function fakeResult(runId: string, costUsd: number, extra: Partial<RunSnapshotResult["stats"]> = {}): RunSnapshotResult {
  return {
    runId,
    costUsd,
    pipeline: { runId, status: "complete", costUsd, answers: [{ answerId: "a", provider: "claude", question: "q1", ok: true, answerCostUsd: 0.05 }] },
    stats: {
      version: 1,
      repeats: 3,
      answers: { locked: 1, fresh: 0 },
      agreement: { totals: { entity: { held: 2, noisy: 1 }, theme: { held: 1, noisy: 4 } } } as never,
      noise: {} as never,
      labels: {},
      ...extra,
    },
  };
}

describe("runWeekly", () => {
  const now = new Date("2026-11-16T05:00:00Z");
  const items = [
    { id: "w1", name: "One" },
    { id: "w2", name: "Two" },
    { id: "w3", name: "Three" },
  ];

  it("runs every active item once, as weekly snapshots, splitting the run cap", async () => {
    const { db, updates } = fakeDb(items);
    const calls: { id: string; opts: RunSnapshotOptions }[] = [];
    const result = await runWeekly(db, {
      now,
      runCapUsd: 15,
      itemCapUsd: 6,
      snapshot: async (_db, id, opts) => {
        calls.push({ id, opts });
        return fakeResult(`run-${id}`, 4.5);
      },
    });
    expect(calls.map((c) => c.id)).toEqual(["w1", "w2", "w3"]);
    expect(calls.every((c) => c.opts.kind === "weekly")).toBe(true);
    expect(calls.map((c) => c.opts.maxCostUsd)).toEqual([6, 6, 6]);
    expect(result.costUsd).toBeCloseTo(13.5);
    expect(result.items.map((i) => i.outcome)).toEqual(["ran", "ran", "ran"]);
    expect(result.items[0]).toMatchObject({ held: 3, noisy: 5, questions: 1 });
    expect(result.items[0].comparedWith).toBeUndefined();
    expect(updates.map((u) => u.id)).toEqual(["run-w1", "run-w2", "run-w3"]);
  });

  it("gives a later item only what's left under the run cap, and skips once under $1", async () => {
    const { db } = fakeDb(items);
    const caps: (number | undefined)[] = [];
    const result = await runWeekly(db, {
      now,
      runCapUsd: 10,
      itemCapUsd: 6,
      snapshot: async (_db, id, opts) => {
        caps.push(opts.maxCostUsd);
        return fakeResult(`run-${id}`, id === "w1" ? 5.5 : 4);
      },
    });
    expect(caps).toEqual([6, 4.5]);
    expect(result.items[2]).toMatchObject({ outcome: "skipped" });
    expect(result.items[2].reason).toMatch(/spending cap/);
  });

  it("never runs an item twice in the same week", async () => {
    const { db } = fakeDb(items, [{ id: "done", watchItemId: "w2", status: "complete", startedAt: new Date("2026-11-16T05:01:00Z") }]);
    const ran: string[] = [];
    const result = await runWeekly(db, {
      now: new Date("2026-11-16T09:00:00Z"),
      snapshot: async (_db, id) => {
        ran.push(id);
        return fakeResult(`run-${id}`, 4);
      },
    });
    expect(ran).toEqual(["w1", "w3"]);
    expect(result.items[1]).toMatchObject({ outcome: "skipped" });
  });

  it("keeps going when one item fails, and marks its run failed", async () => {
    const { db, failedMarked } = fakeDb(items);
    const result = await runWeekly(db, {
      now,
      snapshot: async (_db, id) => {
        if (id === "w2") throw new Error("provider exploded");
        return fakeResult(`run-${id}`, 4);
      },
    });
    expect(result.items.map((i) => i.outcome)).toEqual(["ran", "failed", "ran"]);
    expect(result.items[1].reason).toMatch(/provider exploded/);
    expect(failedMarked).toEqual(["w2"]);
  });

  // Task 4.9: a run stopped by a deploy is released as failed with what it spent; the retry mustn't spend the caps again.
  it("counts this week's earlier runs against the run and item caps on a re-run", async () => {
    const { db } = fakeDb(items, [
      // w1 finished earlier this week; w2 was stopped by SIGTERM after spending $4 and released as failed.
      { id: "done", watchItemId: "w1", status: "complete", startedAt: new Date("2026-11-16T05:01:00Z"), costUsd: 5 },
      { id: "stopped", watchItemId: "w2", status: "failed", startedAt: new Date("2026-11-16T05:20:00Z"), costUsd: 4 },
      // Last week's spend doesn't count.
      { id: "old", watchItemId: "w3", status: "complete", startedAt: new Date("2026-11-09T05:00:00Z"), costUsd: 9 },
    ]);
    const caps: Record<string, number | undefined> = {};
    const result = await runWeekly(db, {
      now: new Date("2026-11-16T06:00:00Z"),
      runCapUsd: 15,
      itemCapUsd: 6,
      snapshot: async (_db, id, opts) => {
        caps[id] = opts.maxCostUsd;
        return fakeResult(`run-${id}`, id === "w2" ? 2 : 3);
      },
    });
    expect(result.earlierUsd).toBe(9);
    expect(result.items[0]).toMatchObject({ outcome: "skipped" });
    // w2 has $2 left of its item cap; w3 gets the $4 left of the week's $15.
    expect(caps).toEqual({ w2: 2, w3: 4 });
  });

  it("skips an item whose stopped runs used up its item cap, counting answers when no cost was stored", async () => {
    const { db } = fakeDb(
      items.slice(0, 2),
      [{ id: "killed", watchItemId: "w1", status: "failed", startedAt: new Date("2026-11-16T05:01:00Z"), costUsd: null }],
      { killed: 5.5 }
    );
    const ran: string[] = [];
    const result = await runWeekly(db, {
      now: new Date("2026-11-16T06:00:00Z"),
      itemCapUsd: 6,
      snapshot: async (_db, id) => {
        ran.push(id);
        return fakeResult(`run-${id}`, 3);
      },
    });
    expect(ran).toEqual(["w2"]);
    expect(result.items[0].reason).toMatch(/item spending cap \$6 reached \(\$5.50/);
  });

  it("stores a comparison against the previous snapshot when there is one", async () => {
    const { db, updates } = fakeDb(items.slice(0, 1), [
      { id: "prev", watchItemId: "w1", status: "complete", startedAt: new Date("2026-11-09T05:00:00Z"), stats: { version: 1 } },
    ]);
    const result = await runWeekly(db, {
      now,
      snapshot: async () => fakeResult("new", 4),
      compare: async (_db, before, after) => {
        expect([before, after]).toEqual(["prev", "new"]);
        return { questions: 8, swings: [{} as never, {} as never] };
      },
    });
    expect(result.items[0]).toMatchObject({ comparedWith: "prev", swings: 2 });
    const stats = updates[0].data.stats as { comparison: { againstRunId: string; questions: number } };
    expect(stats.comparison).toMatchObject({ againstRunId: "prev", questions: 8 });
  });
});
