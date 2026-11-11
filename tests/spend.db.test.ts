/**
 * The public site's daily cap against a real Postgres (task 6.6, security
 * review M1): requests that arrive together reserve budget atomically, so no
 * more of them pass than the cap covers. Runs only with TEST_DATABASE_URL set
 * to a local scratch database; it rewrites today's DailySpend row. CI has
 * none, so it skips.
 *
 *   TEST_DATABASE_URL=postgresql://$USER@127.0.0.1:5432/ate66test npx vitest run tests/spend.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const url = process.env.TEST_DATABASE_URL;
const local = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)("daily spend reservation in Postgres", () => {
  let db: PrismaClient;
  let S: typeof import("@/lib/guards/spend");
  const today = () => {
    const n = new Date();
    return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
  };

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.DAILY_SPEND_CAP_USD = "2";
    db = (await import("@/lib/db")).prisma;
    S = await import("@/lib/guards/spend");
    await db.dailySpend.deleteMany({ where: { day: today() } });
  });
  afterAll(async () => {
    await db.dailySpend.deleteMany({ where: { day: today() } });
    delete process.env.DAILY_SPEND_CAP_USD;
    await db?.$disconnect();
  });

  it("admits only as many simultaneous analyses as the cap covers", async () => {
    // 20 requests at once against a $2 cap at $0.50 each: before 6.6 every one passed the read-only check.
    const reserved = await Promise.all(Array.from({ length: 20 }, () => S.reserveSpend(0.5)));
    expect(reserved.filter((r) => r !== null)).toHaveLength(4);
    expect((await db.dailySpend.findUniqueOrThrow({ where: { day: today() } })).costUsd).toBeCloseTo(2);

    // Each settles to its real cost; the freed budget admits new ones.
    for (const r of reserved.filter((x): x is number => x !== null)) await S.settleSpend({ costUsd: 0.1, reservedUsd: r });
    const row = await db.dailySpend.findUniqueOrThrow({ where: { day: today() } });
    expect(row.costUsd).toBeCloseTo(0.4);
    expect(row.analyses).toBe(4);
    expect(await S.reserveSpend(0.5)).toBe(0.5);
  });

  it("gives a reservation back without counting an analysis", async () => {
    const before = await db.dailySpend.findUniqueOrThrow({ where: { day: today() } });
    await S.settleSpend({ costUsd: 0, reservedUsd: 0.5, analysis: false });
    const after = await db.dailySpend.findUniqueOrThrow({ where: { day: today() } });
    expect(after.costUsd).toBeCloseTo(before.costUsd - 0.5);
    expect(after.analyses).toBe(before.analyses);
  });
});
