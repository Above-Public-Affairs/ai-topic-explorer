/**
 * lib/themes/link.ts against a real Postgres migrated to the current schema.
 * Runs only with TEST_DATABASE_URL set to a local database; CI has none, so
 * it skips. The label mapper is a fake: no AI calls.
 *
 *   TEST_DATABASE_URL=postgresql://jc@localhost:5432/ate_test npx vitest run tests/themes.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const url = process.env.TEST_DATABASE_URL;
const local = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)("theme linking in Postgres", () => {
  let db: PrismaClient;
  let T: typeof import("@/lib/themes");
  const name = `test-themes-${Date.now()}`;
  let itemId: string;
  let noiseId: string;
  const mapperCalls: string[][] = [];

  /** Fake mapper: "grid strain" labels → grid-reliability, "hum" → noise-sources, else new. */
  const client = {
    responses: {
      create: async (req: { input: string }) => {
        const labels = [...req.input.matchAll(/^\d+\. "([^"]+)"/gm)].map((m) => m[1]);
        mapperCalls.push(labels);
        const choices = labels.map((l, index) => ({
          index,
          theme: /grid/i.test(l) ? "grid-reliability" : /hum/i.test(l) ? "noise-sources" : "new",
        }));
        return { status: "completed", output_text: JSON.stringify({ choices }), usage: { input_tokens: 10, output_tokens: 5 } };
      },
    },
  } as never;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.OPENAI_API_KEY ??= "test";
    db = (await import("@/lib/db")).prisma;
    T = await import("@/lib/themes");
    // A small vocabulary for the test item.
    T.THEME_VOCAB[name] = [
      { slug: "grid-reliability", name: "Grid strain and reliability", subTopic: "power generation", description: "Whether the grid keeps up.", aliases: ["grid reliability"] },
      { slug: "electricity-demand", name: "Electricity demand growth", subTopic: "power generation", description: "How much more power.", aliases: ["power demand", "electricity demand"] },
      { slug: "noise-sources", name: "Noise sources and levels", subTopic: "noise", description: "What makes the noise.", aliases: ["noise sources"] },
      { slug: "jobs", name: "Jobs", subTopic: null, description: "Construction and permanent jobs.", aliases: ["jobs"] },
    ];
    const item = await db.watchItem.create({
      data: { name, topic: "Data centers", askCity: "Austin", askRegion: "Texas", subTopics: { create: [{ name: "power generation" }, { name: "noise" }] } },
      include: { subTopics: true },
    });
    itemId = item.id;
    noiseId = item.subTopics.find((s) => s.name === "noise")!.id;
  });

  afterAll(async () => {
    if (db && itemId) {
      await db.run.deleteMany({ where: { watchItemId: itemId } });
      await db.canonicalTheme.deleteMany({ where: { watchItemId: itemId } });
      await db.themeAlias.deleteMany({ where: { watchItemId: itemId } });
      await db.subTopic.deleteMany({ where: { watchItemId: itemId } });
      await db.watchItem.delete({ where: { id: itemId } });
    }
    await db?.$disconnect();
  });

  async function answerWithThemes(labels: { label: string; subTopicId?: string }[]) {
    const run = await db.run.create({ data: { kind: "manual", topic: "Data centers", watchItemId: itemId } });
    const answer = await db.answer.create({
      data: { runId: run.id, question: "q", provider: "claude", requestedModel: "m", locationMode: "none" },
    });
    const ex = await db.extraction.create({
      data: {
        answerId: answer.id,
        model: "fake",
        promptVersion: "test",
        themes: { create: labels.map((l) => ({ label: l.label, normalized: l.label.toLowerCase(), subTopicId: l.subTopicId ?? null })) },
      },
    });
    return { runId: run.id, extractionId: ex.id };
  }

  async function linksOf(extractionId: string) {
    const rows = await db.theme.findMany({ where: { extractionId }, select: { label: true, canonical: { select: { slug: true } } }, orderBy: { label: "asc" } });
    return Object.fromEntries(rows.map((r) => [r.label, r.canonical?.slug ?? null]));
  }

  it("links known wordings with no mapper call and leaves the rest for the snapshot", async () => {
    const a = await answerWithThemes([{ label: "Power Demand" }, { label: "Electricity demand" }, { label: "Grid strain" }]);
    const r = await T.linkThemes(db, { extractionIds: [a.extractionId], map: false });
    expect(r).toMatchObject({ linked: 2, unlinked: 1, costUsd: 0 });
    expect(mapperCalls).toHaveLength(0);
    expect(await linksOf(a.extractionId)).toEqual({ "Electricity demand": "electricity-demand", "Grid strain": null, "Power Demand": "electricity-demand" });
  });

  it("maps the rest in one call, coins new themes, and remembers both", async () => {
    const b = await answerWithThemes([{ label: "Grid strain" }, { label: "Low hum", subTopicId: noiseId }, { label: "Labor competition" }]);
    const r = await T.linkThemes(db, { watchItemId: itemId, client });
    expect(mapperCalls).toHaveLength(1);
    expect(mapperCalls[0].sort()).toEqual(["Grid strain", "Labor competition", "Low hum"]);
    expect(r).toMatchObject({ mapped: 2, created: 1, unlinked: 0 });
    expect(await linksOf(b.extractionId)).toEqual({ "Grid strain": "grid-reliability", "Labor competition": "new-labor-competition", "Low hum": "noise-sources" });

    // The same labels later: alias table only, no call, same themes.
    const c = await answerWithThemes([{ label: "grid strain" }, { label: "Labor Competition" }]);
    await T.linkThemes(db, { watchItemId: itemId, client });
    expect(mapperCalls).toHaveLength(1);
    expect(await linksOf(c.extractionId)).toEqual({ "Labor Competition": "new-labor-competition", "grid strain": "grid-reliability" });
  });

  it("keeps a label's sub-topic in its key", async () => {
    // "Low hum" was mapped under noise; with no sub-topic it is a different key, so it is mapped again.
    const d = await answerWithThemes([{ label: "Low hum" }]);
    await T.linkThemes(db, { watchItemId: itemId, client });
    expect(mapperCalls.at(-1)).toEqual(["Low hum"]);
    expect(await linksOf(d.extractionId)).toEqual({ "Low hum": "noise-sources" });
  });

  it("merges a reviewed new theme into the vocabulary", async () => {
    const res = await T.mergeThemes(db, itemId, "new-labor-competition", "jobs");
    expect(res.mentions).toBe(2);
    expect(await db.canonicalTheme.count({ where: { watchItemId: itemId, slug: "new-labor-competition" } })).toBe(0);
    const e = await answerWithThemes([{ label: "labor competition" }]);
    await T.linkThemes(db, { watchItemId: itemId, map: false });
    expect(await linksOf(e.extractionId)).toEqual({ "labor competition": "jobs" });
  });

  it("relinks from scratch with the same result", async () => {
    const before = await db.theme.findMany({ where: { canonical: { watchItemId: itemId } }, select: { id: true, canonical: { select: { slug: true } } } });
    await T.relinkThemes(db, { watchItemId: itemId, client });
    const after = await db.theme.findMany({ where: { id: { in: before.map((b) => b.id) } }, select: { id: true, canonical: { select: { slug: true } } } });
    const slug = (rows: typeof before) => Object.fromEntries(rows.map((r) => [r.id, r.canonical?.slug]));
    expect(slug(after)).toEqual(slug(before));
  });
});
