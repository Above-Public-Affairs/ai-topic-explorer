/**
 * Baseline selection (lib/snapshots/baselines.ts) against a real Postgres
 * migrated to the current schema; the comparison itself is stubbed. Runs only
 * with TEST_DATABASE_URL set to a local database; CI has none, so it skips.
 *
 *   TEST_DATABASE_URL=postgresql://$USER@127.0.0.1:5432/ate_baselines_test npx vitest run tests/baselines.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, RunKind, RunStatus } from "@/app/generated/prisma/client";
import type { Comparison, Swing } from "@/lib/snapshots";

const url = process.env.TEST_DATABASE_URL;
const local = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)("snapshot baselines in Postgres", () => {
  let db: PrismaClient;
  let S: typeof import("@/lib/snapshots");
  let itemId: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = (await import("@/lib/db")).prisma;
    S = await import("@/lib/snapshots");
    // Inactive, so the watchers' tests sharing this database never act on it.
    const item = await db.watchItem.create({ data: { name: "Baselines test", topic: "data centers", askCity: "Austin", askRegion: "Texas", active: false } });
    itemId = item.id;
  });

  afterAll(async () => {
    await db.run.deleteMany({ where: { watchItemId: itemId } });
    await db.watchItem.delete({ where: { id: itemId } });
    await db.$disconnect();
  });

  const run = (id: string, kind: RunKind, startedAt: string, status: RunStatus = "complete", stats: object | null = { version: 1 }) =>
    db.run.create({ data: { id: `${itemId}-${id}`, kind, status, watchItemId: itemId, topic: "data centers", startedAt: new Date(startedAt), ...(stats ? { stats } : {}) } });
  const id = (s: string) => `${itemId}-${s}`;

  it("picks the most recent usable snapshot first, then the last two weekly ones, before the cutoff", async () => {
    await run("w-oldest", "weekly", "2031-02-24T05:00:00Z");
    await run("w-older", "weekly", "2031-03-03T05:00:00Z");
    await run("w-failed", "weekly", "2031-03-10T05:00:00Z", "failed");
    await run("w-nostats", "weekly", "2031-03-10T06:00:00Z", "complete", null);
    await run("w-last", "weekly", "2031-03-10T07:00:00Z", "partial");
    await run("e-mid", "event", "2031-03-12T18:00:00Z");
    await run("ms", "model_switch", "2031-03-13T13:00:00Z");
    await run("w-after", "weekly", "2031-03-17T05:00:00Z"); // after the event: may show its effect
    await run("new", "event", "2031-03-18T13:00:00Z", "complete");

    const before = new Date("2031-03-16T20:00:00Z"); // the event happened
    expect(await S.findBaselines(db, itemId, { runId: id("new"), before })).toEqual([id("e-mid"), id("w-last"), id("w-older")]);
  });

  it("counts a weekly snapshot once when it is also the most recent", async () => {
    const before = new Date("2031-03-11T00:00:00Z");
    expect(await S.findBaselines(db, itemId, { runId: id("new"), before })).toEqual([id("w-last"), id("w-older")]);
  });

  it("has nothing before the first snapshot", async () => {
    expect(await S.findBaselines(db, itemId, { runId: id("new"), before: new Date("2031-01-01T00:00:00Z") })).toEqual([]);
  });

  it("keeps only swings every baseline confirms, numbered against the most recent", async () => {
    const swing = (key: string, change: number): Swing => ({
      scope: "all", metric: "entity", key, label: key, before: 0.2, after: 0.2 + change, change, threshold: 0.1, countBefore: 2, countAfter: 8, kind: "rose",
    });
    const byBaseline: Record<string, Comparison> = {
      [id("e-mid")]: { questions: 8, swings: [swing("ercot", 0.4), swing("puc", 0.3)] },
      [id("w-last")]: { questions: 8, swings: [swing("ercot", 0.5), swing("puc", 0.3)] },
      [id("w-older")]: { questions: 8, swings: [swing("ercot", 0.45)] },
    };
    const seen: string[] = [];
    const result = await S.compareWithBaselines(db, itemId, id("new"), {
      before: new Date("2031-03-16T20:00:00Z"),
      compare: async (_db, beforeId, afterId) => {
        expect(afterId).toBe(id("new"));
        seen.push(beforeId);
        return byBaseline[beforeId];
      },
    });
    expect(seen).toEqual([id("e-mid"), id("w-last"), id("w-older")]);
    expect(result).toMatchObject({ againstRunId: id("e-mid"), questions: 8, confirmedAgainst: seen, unconfirmed: 1 });
    expect(result!.swings.map((s) => [s.key, s.change])).toEqual([["ercot", 0.4]]);
  });
});
