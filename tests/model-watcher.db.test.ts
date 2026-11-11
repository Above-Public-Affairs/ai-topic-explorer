/**
 * The model watcher's switch path against a real Postgres (saveModel, the
 * Event row, the model_switch runs, resuming, the switch cap). The pipeline is
 * faked, so nothing is asked of any AI. It changes the model list, so point it
 * at a scratch copy, never a database you want to keep. CI has none, so it skips.
 *
 *   createdb -T ate_task43 ate_task45_test
 *   TEST_DATABASE_URL=postgresql://$USER@127.0.0.1:5432/ate_task45_test npx vitest run tests/model-watcher.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { ProviderId } from "@/lib/answers";
import type { runPipeline } from "@/lib/pipeline/run";
import type { CheckOutput } from "@/lib/watchers/models-check";

const url = process.env.TEST_DATABASE_URL;
const local = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)("model watcher switch in Postgres", () => {
  let db: PrismaClient;
  let W: typeof import("@/lib/watchers/models");
  const quote = "Free accounts now use the new model by default";
  const page = `<p>${quote}</p>`;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = (await import("@/lib/db")).prisma;
    W = await import("@/lib/watchers/models");
  });
  afterAll(async () => {
    await db?.$disconnect();
  });

  const changeTo = (model: string) => async (_p: ProviderId, current: { sourceUrl: string | null }): Promise<CheckOutput> => ({
    report: { sameAsCurrent: false, consumerName: model, apiModelId: model, mappingIsGuess: true, evidenceUrl: current.sourceUrl!, evidenceQuote: quote, effectiveDate: "", notes: "" },
    costUsd: 0.01,
    searches: 1,
    sources: [],
    model: "test",
  });

  /** Records which model each call used; every answer costs `each`. */
  function fakePipeline(each: number) {
    const calls: { watchItemId?: string; model?: string; questions: number }[] = [];
    const pipeline = (async (_db, o) => {
      const provider = o.providers![0];
      calls.push({ watchItemId: o.watchItemId, model: o.models?.[provider]?.model, questions: o.questions!.length });
      const answers = o.questions!.map((q) => ({ answerId: "x", provider, question: q.text, ok: true, answerCostUsd: each }));
      return { runId: o.runId!, status: "complete" as const, answers, costUsd: each * answers.length };
    }) as typeof runPipeline;
    return { pipeline, calls };
  }

  const deps = { fetchPage: async () => page, modelExists: async () => true, hasPrices: () => true };

  it("on a change: updates the list, logs the event, asks the anchors on both models per item", async () => {
    const before = await db.modelRegistry.findFirstOrThrow({ where: { role: "answer", provider: "grok", retiredAt: null } });
    const items = await db.watchItem.count({ where: { active: true, retiredAt: null } });
    const { pipeline, calls } = fakePipeline(0.01);
    const now = new Date();
    const r = await W.runModelWatcher(db, { now, providers: ["grok"], check: changeTo("grok-5"), pipeline, ...deps });

    expect(r.providers[0]).toMatchObject({ outcome: "changed", model: before.model, newModel: "grok-5" });
    const after = await db.modelRegistry.findFirstOrThrow({ where: { role: "answer", provider: "grok", retiredAt: null } });
    expect(after.model).toBe("grok-5");
    expect(after.isGuess).toBe(true);
    expect(after.effortLevel).toBe(before.effortLevel);
    expect((await db.modelRegistry.findUniqueOrThrow({ where: { id: before.id } })).retiredAt).not.toBeNull();

    const event = await db.event.findUniqueOrThrow({ where: { id: r.providers[0].eventId! } });
    expect(event).toMatchObject({ category: "new_model", status: "approved", modelRegistryId: after.id, sourceUrl: before.sourceUrl });
    expect(event.runId).not.toBeNull();

    const runs = await db.run.findMany({ where: { kind: "model_switch", stats: { path: ["modelSwitch", "eventId"], equals: event.id } } });
    expect(runs).toHaveLength(items);
    expect(runs.every((x) => x.status === "complete")).toBe(true);
    // Old model first, then new, for every item.
    expect(calls.map((c) => c.model)).toEqual(Array.from({ length: items }, () => [before.model, "grok-5"]).flat());
    const stats = runs[0].stats as unknown as { modelSwitch: { old: { registryId: string }; new: { registryId: string } } };
    expect(stats.modelSwitch.old.registryId).toBe(before.id);
    expect(stats.modelSwitch.new.registryId).toBe(after.id);

    // Run again the same day (a deploy): nothing new is asked.
    const again = await W.runModelWatcher(db, { now: new Date(now.getTime() + 60_000), providers: ["grok"], check: changeTo("grok-6"), pipeline, ...deps });
    expect(again.providers[0].outcome).toBe("skipped");
    expect(calls).toHaveLength(items * 2);
  });

  it("keeps a failed switch run's spend, so the day's switch cap still counts it", async () => {
    const day = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    // Old pass answers and pays $0.40; the new pass pays $0.30, then the database write throws.
    const pipeline = (async (d, o) => {
      const provider = o.providers![0];
      const paid = o.models?.[provider]?.model === "gemini-9" ? 0.3 : 0.4;
      await d.answer.create({ data: { runId: o.runId!, question: "q", provider, requestedModel: "m", locationMode: "none", costUsd: paid } });
      if (paid === 0.3) throw new Error("database went away");
      return { runId: o.runId!, status: "complete" as const, answers: [{ answerId: "x", provider, question: "q", ok: true, answerCostUsd: paid }], costUsd: paid };
    }) as typeof runPipeline;
    const r = await W.runModelWatcher(db, { now: day, providers: ["gemini"], check: changeTo("gemini-9"), pipeline, ...deps });
    const item = r.providers[0].switch!.items.find((i) => i.outcome === "failed")!;
    expect(item.costUsd).toBeCloseTo(0.7, 6);
    const run = await db.run.findUniqueOrThrow({ where: { id: item.runId! } });
    expect(run.status).toBe("failed");
    expect(run.costUsd).toBeCloseTo(0.7, 6);
    expect(r.providers[0].switch!.costUsd).toBeGreaterThanOrEqual(0.7 - 1e-9);
  });

  it("stops at the switch cap, then resumes the rest on the next run", async () => {
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
    const perAnswer = (await db.answer.aggregate({ where: { provider: "openai", errorKind: null, costUsd: { gt: 0 } }, _avg: { costUsd: true } }))._avg.costUsd ?? W.FALLBACK_ANSWER_USD;
    const { pipeline, calls } = fakePipeline(perAnswer);
    // Room for about one item (16 answers) and not two.
    const cap = perAnswer * 16 * 1.5;
    const r = await W.runModelWatcher(db, { now: tomorrow, providers: ["openai"], switchCapUsd: cap, check: changeTo("gpt-7-luna"), pipeline, ...deps });
    const s = r.providers[0].switch!;
    expect(r.providers[0].outcome).toBe("changed");
    expect(s.items.filter((i) => i.outcome === "ran").length).toBeGreaterThanOrEqual(1);
    expect(s.items.some((i) => i.outcome === "skipped" && /switch cap/.test(i.reason!))).toBe(true);
    const ranFirst = calls.length;

    const next = await W.runModelWatcher(db, { now: new Date(tomorrow.getTime() + 3600_000), providers: ["openai"], pipeline, ...deps });
    expect(next.providers[0]).toMatchObject({ outcome: "resumed", eventId: r.providers[0].eventId });
    expect(next.providers[0].switch!.items.filter((i) => i.outcome === "ran").length).toBeGreaterThanOrEqual(1);
    expect(calls.length).toBeGreaterThan(ranFirst);
    // Old model still asked on the resumed items.
    expect(calls.slice(ranFirst)[0].model).toBe("gpt-6-luna");
  });
});
