/**
 * lib/questions/sets.ts against a real Postgres migrated to the current
 * schema (the trigger and constraints are part of what's tested). Runs only
 * with TEST_DATABASE_URL set to a local database; CI has none, so it skips.
 *
 *   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55442/ate npx vitest run tests/question-sets.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { Candidate, GeneratedSet, Generator, ReviewedFile } from "@/lib/questions";

const url = process.env.TEST_DATABASE_URL;
const local = !!url && /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);

describe.skipIf(!local)("question sets in Postgres", () => {
  let db: PrismaClient;
  let Q: typeof import("@/lib/questions");
  const tag = `test-${Date.now()}`;

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = (await import("@/lib/db")).prisma;
    Q = await import("@/lib/questions");
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function newItem(subTopics: string[] = ["wind", "solar"]) {
    return db.watchItem.create({
      data: {
        name: `${tag} ${Math.random().toString(36).slice(2, 8)}`,
        topic: "Renewables",
        geography: "Texas",
        askCity: "Austin",
        askRegion: "Texas",
        askTimezone: "America/Chicago",
        subTopics: { create: subTopics.map((name) => ({ name })) },
      },
    });
  }

  function generated(kind: "anchor" | "fresh", questions: Candidate[]): GeneratedSet {
    return {
      kind,
      questions,
      rejected: [],
      missing: [],
      shape: [],
      model: "fake",
      modelRegistryId: null,
      promptVersion: "test",
      costUsd: 0.001,
      calls: 1,
      inputTokens: 1,
      outputTokens: 1,
      searches: 0,
      searchQueries: [],
      sources: [],
      priceIds: [],
    };
  }

  const ANCHOR: Candidate[] = [
    { text: "do wind farms raise my electric bill", subTopic: "wind", concern: "electric bills", lean: "negative", style: "plain" },
    { text: "are solar farms good for rural texas counties", subTopic: "solar", concern: "rural counties", lean: "positive", style: "plain" },
    { text: "who benefits from renewable energy in texas", subTopic: null, concern: "who benefits", lean: "neutral", style: "plain" },
  ];
  const anchorGen: Generator = async (kind) => generated(kind, ANCHOR);

  /** A fresh-set generator whose questions have the given concerns, recording what it was told. */
  function freshGen(concernsPerCall: string[][], seen: Parameters<Generator>[1][] = []): Generator {
    let call = 0;
    return async (kind, options) => {
      seen.push(options);
      const concerns = concernsPerCall[call++] ?? [];
      return generated(
        kind,
        concerns.map((concern, i) => ({
          text: `Snapshot ${call} question ${i + 1} about ${concern}?`,
          subTopic: i === 0 ? "solar" : null,
          concern,
          lean: i === 0 ? ("negative" as const) : ("positive" as const),
          style: "plain" as const,
          why: "news",
        }))
      );
    };
  }

  async function snapshot(watchItemId: string, generate: Generator, today: Date) {
    const run = await db.run.create({ data: { kind: "weekly", watchItemId, topic: "Renewables", askCity: "Austin" } });
    return { run, result: await Q.questionsForSnapshot(db, { watchItemId, runId: run.id }, { generate, today }) };
  }

  it("drafts, redrafts and locks the anchor set; refuses snapshots until it's locked", async () => {
    const item = await newItem();
    const draft = await Q.draftAnchorSet(db, item.id, { generate: anchorGen });
    expect(draft).toMatchObject({ number: 1, kind: "anchor", lockedAt: null, costUsd: 0.001 });
    expect(draft.questions.map((q) => q.text)).toEqual(ANCHOR.map((q) => q.text));
    const solar = await db.subTopic.findFirstOrThrow({ where: { watchItemId: item.id, name: "solar" } });
    expect(draft.questions[1].subTopicId).toBe(solar.id);
    expect(draft.questions.map((q) => q.lean)).toEqual(["negative", "positive", "neutral"]);

    const run = await db.run.create({ data: { kind: "weekly", watchItemId: item.id, topic: "R" } });
    await expect(Q.questionsForSnapshot(db, { watchItemId: item.id, runId: run.id }, { generate: freshGen([["x"]]) })).rejects.toThrow(/no locked anchor set/);

    // A draft can be rewritten; it's never been asked.
    const redraft = await Q.draftAnchorSet(db, item.id, { questions: ANCHOR.slice(0, 2) });
    expect(redraft.questions).toHaveLength(2);
    expect(await db.questionSet.count({ where: { watchItemId: item.id } })).toBe(1);

    await Q.lockAnchorSet(db, item.id);
    await expect(Q.draftAnchorSet(db, item.id, { generate: anchorGen })).rejects.toThrow(/locked/);
    await expect(Q.lockAnchorSet(db, item.id)).rejects.toThrow(/already locked/);
  });

  it("never edits or deletes a locked question; retiring keeps its history", async () => {
    const item = await newItem();
    const set = await Q.draftAnchorSet(db, item.id, { generate: anchorGen });
    await Q.lockAnchorSet(db, item.id);
    const first = set.questions[0];

    await expect(db.question.update({ where: { id: first.id }, data: { text: "Edited?" } })).rejects.toThrow(/never edited/);
    await expect(db.question.delete({ where: { id: first.id } })).rejects.toThrow(/locked set/);

    const retired = await Q.retireQuestion(db, first.id, "Stale: asked about a program that ended");
    expect(retired.retiredAt).toBeInstanceOf(Date);
    expect(retired.text).toBe(first.text);
    const locked = await Q.lockedQuestions(db, item.id);
    expect(locked.map((q) => q.label)).toEqual(["1.2", "1.3"]);
  });

  it("gives each snapshot the locked set plus a new fresh set, once per run", async () => {
    const item = await newItem();
    await Q.draftAnchorSet(db, item.id, { generate: anchorGen });
    await Q.lockAnchorSet(db, item.id);
    const seen: Parameters<Generator>[1][] = [];
    const gen = freshGen([["grid outages", "battery fires"], ["grid outages"]], seen);

    const a = await snapshot(item.id, gen, new Date("2026-11-02T12:00:00Z"));
    expect(a.result.locked.map((q) => q.label)).toEqual(["1.1", "1.2", "1.3"]);
    expect(a.result.fresh.map((q) => q.label)).toEqual(["2.1", "2.2"]);
    expect(a.result.fresh[0]).toMatchObject({ setKind: "fresh", concern: "grid outages", lean: "negative" });
    expect(a.result.costUsd).toBe(0.001);
    // The generator is told the locked questions so it doesn't repeat them.
    expect(seen[0].locked?.map((q) => q.text)).toEqual(ANCHOR.map((q) => q.text));
    expect(seen[0].subTopics).toEqual(["wind", "solar"]);

    // Asking again for the same run returns the same fresh set, without writing a new one.
    const again = await Q.questionsForSnapshot(db, { watchItemId: item.id, runId: a.run.id }, { generate: gen });
    expect(again.fresh.map((q) => q.id)).toEqual(a.result.fresh.map((q) => q.id));
    expect(again.costUsd).toBe(0);
    expect(seen).toHaveLength(1);

    // The next snapshot gets set 3 and the earlier concern labels to reuse.
    const b = await snapshot(item.id, gen, new Date("2026-11-09T12:00:00Z"));
    expect(b.result.fresh.map((q) => q.label)).toEqual(["3.1"]);
    expect(seen[1].recentConcerns).toEqual(["grid outages", "battery fires"]);
    const set = await db.questionSet.findUniqueOrThrow({ where: { runId: b.run.id } });
    expect(set).toMatchObject({ kind: "fresh", number: 3, model: "fake", promptVersion: "test" });
    expect(set.lockedAt).toBeInstanceOf(Date);

    // A run of another watch item is refused.
    const other = await newItem();
    await expect(Q.questionsForSnapshot(db, { watchItemId: other.id, runId: b.run.id }, { generate: gen })).rejects.toThrow();
  });

  // Task 6.6, security review L2 (Josh, 2026-11-11: never add automatically).
  it("lists a fresh concern seen in 3 of the last 4 snapshots, but never adds it to the locked questions", async () => {
    const item = await newItem();
    await Q.draftAnchorSet(db, item.id, { generate: anchorGen });
    await Q.lockAnchorSet(db, item.id);
    const gen = freshGen([
      ["grid outages", "a"],
      ["b", "electric bills"],
      ["grid outages", "electric bills"],
      ["grid outages", "electric bills"],
      ["e"],
      ["f"],
    ]);
    const week = (n: number) => new Date(Date.UTC(2026, 10, 2 + 7 * n, 12));

    for (let n = 0; n < 4; n++) await snapshot(item.id, gen, week(n));
    // "grid outages" was in 3 of the last 4 fresh sets. "electric bills" recurs
    // too, but a locked anchor question already asks about it.
    const recurring = await Q.recurringQuestions(db, item.id);
    expect(recurring.map((p) => [p.concern, p.seenIn])).toEqual([["grid outages", 3]]);
    // The latest wording, word for word, from the fourth fresh set.
    expect(recurring[0].text).toBe("Snapshot 4 question 1 about grid outages?");

    // Snapshot 5 asks only the anchor questions as fixed ones: nothing was promoted.
    const five = await snapshot(item.id, gen, week(4));
    expect(five.result.locked.map((q) => q.label)).toEqual(["1.1", "1.2", "1.3"]);
    expect(await db.questionSet.count({ where: { watchItemId: item.id, kind: "promoted" } })).toBe(0);
  });

  it("inserts a reviewed anchor file locked through the migration SQL, and re-running changes nothing", async () => {
    const item = await newItem(["noise"]);
    const file: ReviewedFile = {
      writtenAt: "2026-11-07T00:00:00.000Z",
      model: "gpt-6-luna",
      promptVersion: "2026-11-07.1",
      items: [
        {
          watchItem: item.name,
          questions: [
            { label: "1.1", text: "how loud are data centers for people who live nearby", subTopic: "noise", concern: "noise near homes", lean: "negative" },
            { label: "1.2", text: "what do texas towns get from data centers, and what's it cost them", subTopic: null, concern: "Local Benefits", lean: "positive" },
          ],
        },
      ],
    };
    const sql = Q.anchorMigrationSql(file, "2026-11-10");
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query(sql);
      await pool.query(sql);
    } finally {
      await pool.end();
    }
    const sets = await db.questionSet.findMany({ where: { watchItemId: item.id }, include: { questions: { orderBy: { position: "asc" } } } });
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ kind: "anchor", number: 1, model: "gpt-6-luna" });
    expect(sets[0].lockedAt).toBeInstanceOf(Date);
    expect(sets[0].questions.map((q) => [q.position, q.text, q.concern, q.lean])).toEqual([
      [1, "how loud are data centers for people who live nearby", "noise near homes", "negative"],
      [2, "what do texas towns get from data centers, and what's it cost them", "local benefits", "positive"],
    ]);
    const noise = await db.subTopic.findFirstOrThrow({ where: { watchItemId: item.id, name: "noise" } });
    expect(sets[0].questions[0].subTopicId).toBe(noise.id);
    expect((await Q.lockedQuestions(db, item.id)).map((q) => q.label)).toEqual(["1.1", "1.2"]);
  });
});
