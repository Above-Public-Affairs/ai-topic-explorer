/**
 * afterSnapshot() end to end against a local Postgres holding a snapshot with
 * a stored comparison (task 5.2's proof copy), with the writer and the sender
 * stubbed (no AI calls, no email). Skips unless TEST_ALERTS_DATABASE_URL and
 * TEST_ALERTS_RUN_ID are set; CI has neither. It deletes and recreates that
 * run's alerts, so point it at a proof copy, never production.
 *
 *   TEST_ALERTS_DATABASE_URL=postgresql://jc@127.0.0.1:5432/ate_task52b TEST_ALERTS_RUN_ID=cmw9tp9zn00008wi15ujm7yxt npx vitest run tests/alerts.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { AlertFacts, WrittenSummary } from "@/lib/alerts";

const url = process.env.TEST_ALERTS_DATABASE_URL;
const runId = process.env.TEST_ALERTS_RUN_ID ?? "";
const local = !!url && !!runId && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)("afterSnapshot in Postgres", () => {
  let db: PrismaClient;
  let A: typeof import("@/lib/alerts");
  const sent: string[] = [];
  const send = async (e: { subject: string }) => {
    await new Promise((r) => setTimeout(r, 20));
    sent.push(e.subject);
    return { messageId: "test", sentAt: new Date() };
  };
  const write = async (f: AlertFacts): Promise<WrittenSummary> => ({ ...A.templateSummary(f), writer: "template", costUsd: 0 });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = (await import("@/lib/db")).prisma;
    A = await import("@/lib/alerts");
    await db.alert.deleteMany({ where: { runId } });
  });
  afterAll(async () => {
    await db.alert.deleteMany({ where: { runId } });
    await db.$disconnect();
  });

  it("stores alerts as suppressed when off, and a re-run adds none", async () => {
    const first = await A.afterSnapshot(db, runId, { enabled: false, write, send });
    expect(first.error).toBeUndefined();
    expect(first.created).toBeGreaterThan(0);
    expect(first.created).toBeLessThanOrEqual(A.MAX_ALERTS_PER_SNAPSHOT);
    expect(first.suppressed).toBe(first.created);
    const again = await A.afterSnapshot(db, runId, { enabled: true, write, send });
    expect(again).toMatchObject({ created: 0, existing: first.created, sent: 0 });
    expect(sent).toEqual([]);
    const rows = await db.alert.findMany({ where: { runId } });
    expect(rows.every((r) => r.status === "suppressed" && r.subject.startsWith(`A-${r.number} · `))).toBe(true);
    expect(rows.every((r) => (r.facts as unknown as AlertFacts).askedAs.startsWith("Asked as a user in "))).toBe(true);
  });

  it("sends each alert exactly once, even with two processes at the same time", async () => {
    await db.alert.deleteMany({ where: { runId } });
    sent.length = 0;
    const [a, b] = await Promise.all([A.afterSnapshot(db, runId, { enabled: true, write, send }), A.afterSnapshot(db, runId, { enabled: true, write, send })]);
    const rows = await db.alert.findMany({ where: { runId } });
    expect(rows.length).toBeGreaterThan(0);
    expect(a.error ?? b.error).toBeUndefined();
    expect(rows.every((r) => r.status === "sent")).toBe(true);
    expect(sent).toHaveLength(rows.length);
    expect(new Set(sent).size).toBe(rows.length);
    const again = await A.afterSnapshot(db, runId, { enabled: true, write, send });
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(rows.length);
  });
});
