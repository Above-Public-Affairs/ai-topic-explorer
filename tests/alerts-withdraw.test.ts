/**
 * Task 4.9: alerts judged unreliable are withdrawn, not deleted, and the
 * monthly report's loader leaves them out.
 */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { REPORTED_ALERT_STATUSES, withdrawAlerts } from "@/lib/alerts/withdraw";
import { loadItemMonth } from "@/lib/reports/load";

interface Row {
  id: string;
  number: number;
  status: string;
  note: string | null;
  watchItemId: string;
  createdAt: Date;
  subject: string;
}

const NOV = new Date("2026-11-10T19:00:00Z");

function alertRows(): Row[] {
  return [
    { id: "a1", number: 1, status: "suppressed", note: null, watchItemId: "w1", createdAt: NOV, subject: "A-1: fewer answers mention ERCOT" },
    { id: "a2", number: 2, status: "suppressed", note: null, watchItemId: "w1", createdAt: NOV, subject: "A-2: Abbott named more often" },
    { id: "a3", number: 3, status: "suppressed", note: "writer fell back to template", watchItemId: "w1", createdAt: NOV, subject: "A-3: tone more negative" },
    { id: "a4", number: 4, status: "sent", note: null, watchItemId: "w1", createdAt: NOV, subject: "A-4: a later, sound alert" },
    { id: "a5", number: 5, status: "failed", note: "send failed", watchItemId: "w1", createdAt: NOV, subject: "A-5: failed send" },
  ];
}

/** Just enough of PrismaClient for withdrawAlerts() and loadItemMonth() with no snapshots. */
function fakeDb(rows: Row[]) {
  const where = (r: Row, w: { number?: { in: number[] }; watchItemId?: string; status?: { in: string[] }; createdAt?: { gte: Date; lt: Date } }) =>
    (!w.number || w.number.in.includes(r.number)) &&
    (!w.watchItemId || r.watchItemId === w.watchItemId) &&
    (!w.status || w.status.in.includes(r.status)) &&
    (!w.createdAt || (r.createdAt >= w.createdAt.gte && r.createdAt < w.createdAt.lt));
  const db = {
    alert: {
      findMany: async ({ where: w }: { where: Parameters<typeof where>[1] }) => rows.filter((r) => where(r, w)).sort((a, b) => a.number - b.number),
      update: async ({ where: w, data }: { where: { id: string }; data: Partial<Row> }) => Object.assign(rows.find((r) => r.id === w.id)!, data),
    },
    watchItem: {
      findUniqueOrThrow: async () => ({ id: "w1", name: "Data centers in Texas", geography: "Texas", askCity: "Austin", askRegion: "Texas", askCountry: "US" }),
    },
    run: { findMany: async () => [], findFirst: async () => null, count: async () => 0 },
    event: { findMany: async () => [] },
  };
  return db as unknown as PrismaClient;
}

const REASON = "the Nov 10 event snapshot was partial: OpenAI credits ran out, so it has no ChatGPT answers";
const month = { key: "2026-11", label: "November 2026", start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-12-01T00:00:00Z") } as never;

describe("withdrawn alerts", () => {
  it("marks alerts withdrawn with the reason, keeping the rows and earlier notes", async () => {
    const rows = alertRows();
    const result = await withdrawAlerts(fakeDb(rows), [1, 2, 3], REASON);
    expect(result.map((r) => [r.number, r.outcome, r.from])).toEqual([
      [1, "withdrawn", "suppressed"],
      [2, "withdrawn", "suppressed"],
      [3, "withdrawn", "suppressed"],
    ]);
    expect(rows).toHaveLength(5);
    expect(rows.slice(0, 3).every((r) => r.status === "withdrawn" && r.note!.includes("OpenAI credits ran out"))).toBe(true);
    expect(rows[2].note).toMatch(/earlier note: writer fell back to template$/);
    expect(rows[3].status).toBe("sent");
  });

  it("is safe to repeat, and refuses unknown alerts or a missing reason", async () => {
    const db = fakeDb(alertRows());
    await withdrawAlerts(db, [1], REASON);
    expect((await withdrawAlerts(db, [1], REASON))[0].outcome).toBe("already withdrawn");
    await expect(withdrawAlerts(db, [1, 99], REASON)).rejects.toThrow(/A-99/);
    await expect(withdrawAlerts(db, [2], " ")).rejects.toThrow(/reason/);
  });

  // Task 6.6, code review M4: an alert stuck in "sending" can still be withdrawn.
  it("withdraws an alert stuck in sending, but not one being sent right now", async () => {
    const rows = [
      { ...alertRows()[0], status: "sending", updatedAt: new Date(Date.now() - 60 * 60 * 1000) },
      { ...alertRows()[1], status: "sending", updatedAt: new Date() },
    ];
    const db = fakeDb(rows as Row[]);
    expect((await withdrawAlerts(db, [1], REASON))[0]).toMatchObject({ outcome: "withdrawn", from: "sending" });
    await expect(withdrawAlerts(db, [2], REASON)).rejects.toThrow(/being sent right now/);
  });

  it("only sent and suppressed alerts count as reported", () => {
    expect([...REPORTED_ALERT_STATUSES]).toEqual(["sent", "suppressed"]);
  });

  it("the monthly report's loader skips withdrawn alerts", async () => {
    const rows = alertRows();
    const db = fakeDb(rows);
    expect((await loadItemMonth(db, "w1", month)).alerts.map((a) => a.number)).toEqual([1, 2, 3, 4]);
    await withdrawAlerts(db, [1, 2, 3], REASON);
    const after = await loadItemMonth(db, "w1", month);
    expect(after.alerts.map((a) => a.number)).toEqual([4]);
  });
});
