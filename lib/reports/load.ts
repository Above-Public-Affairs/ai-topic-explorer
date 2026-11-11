/**
 * Read one watch item's month from the database for the monthly report.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { ProviderId } from "@/lib/answers";
import { REPORTED_ALERT_STATUSES } from "@/lib/alerts/withdraw";
import { loadFindings, noiseBand, type SnapshotStats } from "@/lib/snapshots";
import { recurringQuestions } from "@/lib/questions/sets";
import { PROMOTION_WINDOW } from "@/lib/questions/rules";
import type { ItemMonthInput, ReportMonth, SnapshotInput, TimelineMark } from "./types";

const DONE = ["complete", "partial"] as const;

interface RunRow {
  id: string;
  kind: string;
  startedAt: Date;
  askCity: string | null;
  askRegion: string | null;
  askCountry: string | null;
  stats: unknown;
}

const RUN_SELECT = { id: true, kind: true, startedAt: true, askCity: true, askRegion: true, askCountry: true, stats: true } as const;

async function snapshotInput(db: PrismaClient, run: RunRow): Promise<SnapshotInput> {
  const { answers, labels } = await loadFindings(db, run.id);
  const stats = run.stats as SnapshotStats | null;
  return {
    runId: run.id,
    kind: run.kind === "event" ? "event" : "weekly",
    startedAt: run.startedAt,
    askedFrom: run.askCity && run.askRegion ? { city: run.askCity, region: run.askRegion, country: run.askCountry ?? "US" } : null,
    answers,
    labels: { ...labels, ...(stats?.labels ?? {}) },
    noise: stats?.noise ?? noiseBand(answers),
  };
}

/** Complete or partial weekly snapshots of an item, through the month's end. */
export function countWeekly(db: PrismaClient, watchItemId: string, month: ReportMonth): Promise<number> {
  return db.run.count({ where: { watchItemId, kind: "weekly", status: { in: [...DONE] }, startedAt: { lt: month.end } } });
}

export async function loadItemMonth(db: PrismaClient, watchItemId: string, month: ReportMonth): Promise<ItemMonthInput> {
  const item = await db.watchItem.findUniqueOrThrow({
    where: { id: watchItemId },
    select: { id: true, name: true, geography: true, askCity: true, askRegion: true, askCountry: true },
  });
  const snapshotWhere = { watchItemId, kind: { in: ["weekly" as const, "event" as const] }, status: { in: [...DONE] } };
  const [inMonth, before, weeklyCount, events, switches, alerts] = await Promise.all([
    db.run.findMany({ where: { ...snapshotWhere, startedAt: { gte: month.start, lt: month.end } }, orderBy: { startedAt: "asc" }, select: RUN_SELECT }),
    db.run.findFirst({ where: { ...snapshotWhere, startedAt: { lt: month.start } }, orderBy: { startedAt: "desc" }, select: RUN_SELECT }),
    countWeekly(db, watchItemId, month),
    db.event.findMany({
      where: {
        status: "approved",
        occurredAt: { gte: month.start, lt: month.end },
        OR: [
          { watchItemId },
          // Provider-wide and geography-wide events apply to every item they cover.
          { watchItemId: null, OR: [{ geography: null }, ...(item.geography ? [{ geography: item.geography }] : [])] },
        ],
      },
      orderBy: { occurredAt: "asc" },
      select: { category: true, title: true, occurredAt: true, runId: true, sourceUrl: true, modelRegistry: { select: { provider: true, model: true } } },
    }),
    db.run.findMany({
      where: { watchItemId, kind: "model_switch", startedAt: { gte: month.start, lt: month.end } },
      orderBy: { startedAt: "asc" },
      select: { id: true, startedAt: true, note: true },
    }),
    // Alerts that were raised: sent, or stored while sending was off. Failed, in-flight and withdrawn (unreliable) ones are left out.
    db.alert.findMany({
      where: { watchItemId, createdAt: { gte: month.start, lt: month.end }, status: { in: [...REPORTED_ALERT_STATUSES] } },
      orderBy: { number: "asc" },
      select: { number: true, createdAt: true, subject: true, status: true },
    }),
  ]);

  const marks: TimelineMark[] = [
    ...events.map((e): TimelineMark => ({
      at: e.occurredAt,
      kind: e.category === "new_model" ? "new_model" : "event",
      label: e.category === "new_model" && e.modelRegistry ? `New ${e.modelRegistry.provider} default: ${e.modelRegistry.model}` : e.title,
      ...(e.modelRegistry ? { provider: e.modelRegistry.provider as ProviderId } : {}),
      ...(e.runId ? { runId: e.runId } : {}),
      ...(e.sourceUrl ? { sourceUrl: e.sourceUrl } : {}),
    })),
    ...switches.map((r): TimelineMark => ({ at: r.startedAt, kind: "model_switch", label: "Old and new model asked side by side", runId: r.id })),
  ];

  // Only listed: a person decides whether any joins the fixed questions (task 6.6, security review L2).
  const recurring = await recurringQuestions(db, watchItemId).catch(() => []);

  return {
    watchItem: { id: item.id, name: item.name, askedFrom: { city: item.askCity, region: item.askRegion, country: item.askCountry } },
    recurring: recurring.map((q) => ({ text: q.text, seenIn: q.seenIn, of: PROMOTION_WINDOW })),
    month,
    baseline: before ? await snapshotInput(db, before) : null,
    snapshots: await Promise.all(inMonth.map((r) => snapshotInput(db, r))),
    weeklyCount,
    marks,
    alerts,
  };
}
