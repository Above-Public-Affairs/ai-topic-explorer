/**
 * A watch item's question sets in the database (PROJECT-PLAN §4B):
 *
 * - Anchor set (set 1): written once as a draft, read by a person, then
 *   locked. Locked questions are never edited or deleted (a database trigger
 *   enforces it); a stale one is retired with a date and a reason.
 * - Fresh set (2, 3, …): written new for each snapshot, tied to its Run,
 *   locked as soon as it's written, asked once.
 * - Promoted set: when a fresh question keeps recurring (rules.ts
 *   findPromotions), its latest wording is copied into a new locked set with
 *   its own start date and asked every snapshot from then on.
 *
 * questionsForSnapshot() is the one entry point a snapshot uses.
 */
import type { PrismaClient, QuestionSetKind } from "@/app/generated/prisma/client";
import { generateSet, type GenerateOptions, type GeneratedSet, type SetKind, type WatchItemForQuestions } from "./generate";
import { PROMOTION_WINDOW, findPromotions, normalizeConcern, type Candidate, type Promotion } from "./rules";

type Db = PrismaClient;
export type Generator = (kind: SetKind, options: GenerateOptions) => Promise<GeneratedSet>;

/** The anchor set is always set 1; fresh and promoted sets number on from 2. */
export const ANCHOR_SET_NUMBER = 1;

export class QuestionSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuestionSetError";
  }
}

export interface SnapshotQuestion {
  id: string;
  /** "1.3": set 1, position 3. */
  label: string;
  text: string;
  setKind: QuestionSetKind;
  setNumber: number;
  subTopicId: string | null;
  concern: string | null;
}

export function questionLabel(setNumber: number, position: number): string {
  return `${setNumber}.${position}`;
}

async function loadItem(db: Db, watchItemId: string) {
  const item = await db.watchItem.findUnique({
    where: { id: watchItemId },
    include: { subTopics: { where: { retiredAt: null }, orderBy: { createdAt: "asc" } } },
  });
  if (!item) throw new QuestionSetError(`No watch item ${watchItemId}`);
  return item;
}

function forGenerator(item: Awaited<ReturnType<typeof loadItem>>): { item: WatchItemForQuestions; subTopics: string[] } {
  return {
    item: {
      name: item.name,
      topic: item.topic,
      geography: item.geography,
      askCity: item.askCity,
      askRegion: item.askRegion,
      askCountry: item.askCountry,
      askTimezone: item.askTimezone,
    },
    subTopics: item.subTopics.map((s) => s.name),
  };
}

function generationJson(g: GeneratedSet) {
  return {
    calls: g.calls,
    inputTokens: g.inputTokens,
    outputTokens: g.outputTokens,
    searches: g.searches,
    searchQueries: g.searchQueries,
    sources: g.sources,
    priceIds: g.priceIds,
    rejected: g.rejected.map((r) => ({ text: r.text, issues: r.issues })),
    missing: g.missing,
  };
}

function questionRows(questions: Candidate[], subTopicIds: Map<string, string>) {
  return questions.map((q, i) => ({
    position: i + 1,
    text: q.text,
    subTopicId: q.subTopic ? (subTopicIds.get(q.subTopic) ?? null) : null,
    concern: q.concern ? normalizeConcern(q.concern) : null,
    why: q.why ?? null,
  }));
}

async function nextSetNumber(db: Pick<Db, "questionSet">, watchItemId: string): Promise<number> {
  const top = await db.questionSet.aggregate({ where: { watchItemId }, _max: { number: true } });
  return Math.max(top._max.number ?? 0, ANCHOR_SET_NUMBER) + 1;
}

/**
 * Write the anchor set as a draft (unlocked; never asked until locked).
 * Replaces an earlier draft. Refuses once the anchor set is locked. Pass
 * `questions` to store a set that was already written and read (a reviewed
 * file) instead of writing a new one.
 */
export async function draftAnchorSet(
  db: Db,
  watchItemId: string,
  options: { questions?: Candidate[]; generate?: Generator; signal?: AbortSignal } = {}
) {
  const item = await loadItem(db, watchItemId);
  const current = await db.questionSet.findUnique({
    where: { watchItemId_number: { watchItemId, number: ANCHOR_SET_NUMBER } },
    include: { questions: { select: { id: true, _count: { select: { answers: true } } } } },
  });
  if (current?.lockedAt) throw new QuestionSetError(`${item.name}: the anchor set is locked; retire questions instead of rewriting it`);
  if (current && current.questions.some((q) => q._count.answers > 0)) {
    throw new QuestionSetError(`${item.name}: the draft anchor set already has answers`);
  }

  let generated: GeneratedSet | null = null;
  let questions = options.questions;
  if (!questions) {
    generated = await (options.generate ?? generateSet)("anchor", { ...forGenerator(item), signal: options.signal });
    questions = generated.questions;
  }
  const subTopicIds = new Map(item.subTopics.map((s) => [s.name, s.id]));

  return db.$transaction(async (tx) => {
    if (current) {
      await tx.question.deleteMany({ where: { setId: current.id } });
      await tx.questionSet.delete({ where: { id: current.id } });
    }
    return tx.questionSet.create({
      data: {
        watchItemId,
        kind: "anchor",
        number: ANCHOR_SET_NUMBER,
        model: generated?.model ?? null,
        modelRegistryId: generated?.modelRegistryId ?? null,
        promptVersion: generated?.promptVersion ?? null,
        costUsd: generated?.costUsd ?? null,
        generation: generated ? generationJson(generated) : { source: "reviewed file" },
        questions: { create: questionRows(questions!, subTopicIds) },
      },
      include: { questions: { orderBy: { position: "asc" } } },
    });
  });
}

/** Lock the draft anchor set: from now on it's asked word for word every snapshot. */
export async function lockAnchorSet(db: Db, watchItemId: string) {
  const set = await db.questionSet.findUnique({ where: { watchItemId_number: { watchItemId, number: ANCHOR_SET_NUMBER } } });
  if (!set) throw new QuestionSetError("No draft anchor set to lock");
  if (set.lockedAt) throw new QuestionSetError("The anchor set is already locked");
  const now = new Date();
  return db.questionSet.update({ where: { id: set.id }, data: { lockedAt: now, startedAt: now } });
}

/** Retire a locked question: it stops being asked, its history stays. Its wording is never edited. */
export async function retireQuestion(db: Db, questionId: string, reason: string) {
  const q = await db.question.findUnique({ where: { id: questionId }, include: { set: true } });
  if (!q) throw new QuestionSetError(`No question ${questionId}`);
  if (q.set.kind === "fresh") throw new QuestionSetError("Fresh questions are asked once; there's nothing to retire");
  if (!q.set.lockedAt) throw new QuestionSetError("The set isn't locked yet: rewrite the draft instead");
  if (q.retiredAt) return q;
  return db.question.update({ where: { id: questionId }, data: { retiredAt: new Date(), retiredReason: reason } });
}

/** Questions asked every snapshot: the locked anchor and promoted sets, minus retired ones. */
export async function lockedQuestions(db: Db, watchItemId: string): Promise<SnapshotQuestion[]> {
  const sets = await db.questionSet.findMany({
    where: { watchItemId, kind: { in: ["anchor", "promoted"] }, lockedAt: { not: null } },
    orderBy: { number: "asc" },
    include: { questions: { where: { retiredAt: null }, orderBy: { position: "asc" } } },
  });
  return sets.flatMap((s) =>
    s.questions.map((q) => ({
      id: q.id,
      label: questionLabel(s.number, q.position),
      text: q.text,
      setKind: s.kind,
      setNumber: s.number,
      subTopicId: q.subTopicId,
      concern: q.concern,
    }))
  );
}

/** The last PROMOTION_WINDOW fresh sets, newest first, optionally leaving one run's set out. */
async function recentFreshSets(db: Db, watchItemId: string, excludeRunId?: string) {
  return db.questionSet.findMany({
    where: { watchItemId, kind: "fresh", ...(excludeRunId ? { NOT: { runId: excludeRunId } } : {}) },
    orderBy: { startedAt: "desc" },
    take: PROMOTION_WINDOW,
    include: { questions: { orderBy: { position: "asc" } } },
  });
}

/**
 * Promote recurring fresh questions (rules.ts findPromotions) into one new
 * locked set dated now. Returns what was promoted, empty when nothing was.
 */
export async function promoteRecurring(
  db: Db,
  watchItemId: string,
  options: { excludeRunId?: string; now?: Date } = {}
): Promise<{ setNumber: number | null; promotions: Promotion[] }> {
  const fresh = await recentFreshSets(db, watchItemId, options.excludeRunId);
  const locked = await lockedQuestions(db, watchItemId);
  const activePromoted = locked.filter((q) => q.setKind === "promoted").length;
  const promotions = findPromotions(
    fresh.map((s) => ({ setId: s.id, startedAt: s.startedAt, questions: s.questions })),
    locked.flatMap((q) => (q.concern ? [q.concern] : [])),
    activePromoted
  );
  if (promotions.length === 0) return { setNumber: null, promotions };
  const now = options.now ?? new Date();
  const set = await db.$transaction(async (tx) =>
    tx.questionSet.create({
      data: {
        watchItemId,
        kind: "promoted",
        number: await nextSetNumber(tx, watchItemId),
        startedAt: now,
        lockedAt: now,
        generation: { rule: "promotion", promotions: promotions.map((p) => ({ concern: p.concern, seenIn: p.seenIn, from: p.fromQuestionId })) },
        questions: {
          create: promotions.map((p, i) => ({
            position: i + 1,
            text: p.text,
            subTopicId: p.subTopicId,
            concern: p.concern,
            promotedFromId: p.fromQuestionId,
          })),
        },
      },
    })
  );
  return { setNumber: set.number, promotions };
}

export interface SnapshotQuestions {
  /** Asked every snapshot, word for word: the anchor set and any promoted sets. */
  locked: SnapshotQuestion[];
  /** Written for this snapshot and asked once. */
  fresh: SnapshotQuestion[];
  /** Promoted at this snapshot (already included in `locked`). */
  promoted: Promotion[];
  freshSetNumber: number;
  /** What writing the fresh set cost; 0 when it already existed. */
  costUsd: number;
}

/**
 * The questions a snapshot asks: the locked anchor set (plus promoted sets),
 * and a fresh set written now with web search. Idempotent per run: a second
 * call for the same run returns the fresh set already written. Refuses while
 * the watch item's anchor set isn't locked, since a person reads it first.
 *
 * Order: recurring fresh questions from earlier snapshots are promoted first,
 * then the fresh set is written knowing every locked question, so it doesn't
 * repeat them, and reusing recent concern labels so recurrence can be counted.
 */
export async function questionsForSnapshot(
  db: Db,
  input: { watchItemId: string; runId: string },
  options: { generate?: Generator; signal?: AbortSignal; today?: Date } = {}
): Promise<SnapshotQuestions> {
  const { watchItemId, runId } = input;
  const item = await loadItem(db, watchItemId);
  const anchor = await db.questionSet.findUnique({ where: { watchItemId_number: { watchItemId, number: ANCHOR_SET_NUMBER } } });
  if (!anchor?.lockedAt) {
    throw new QuestionSetError(`${item.name}: no locked anchor set yet. Write and read the draft, then lock it (scripts/question-sets.ts).`);
  }
  const run = await db.run.findUnique({ where: { id: runId }, select: { watchItemId: true } });
  if (!run) throw new QuestionSetError(`No run ${runId}`);
  if (run.watchItemId !== watchItemId) throw new QuestionSetError(`Run ${runId} isn't a snapshot of ${item.name}`);

  const existing = await db.questionSet.findUnique({
    where: { runId },
    include: { questions: { orderBy: { position: "asc" } } },
  });
  if (existing) {
    return {
      locked: await lockedQuestions(db, watchItemId),
      fresh: existing.questions.map((q) => toSnapshotQuestion(existing, q)),
      promoted: [],
      freshSetNumber: existing.number,
      costUsd: 0,
    };
  }

  const { promotions } = await promoteRecurring(db, watchItemId, { excludeRunId: runId, now: options.today });
  const locked = await lockedQuestions(db, watchItemId);
  const recent = await recentFreshSets(db, watchItemId, runId);
  const recentConcerns = [...new Set(recent.flatMap((s) => s.questions.flatMap((q) => (q.concern ? [q.concern] : []))))];

  const generated = await (options.generate ?? generateSet)("fresh", {
    ...forGenerator(item),
    locked: locked.map((q) => ({ text: q.text, concern: q.concern })),
    recentConcerns,
    today: options.today,
    signal: options.signal,
  });
  if (generated.questions.length === 0) throw new QuestionSetError(`${item.name}: the fresh set came back empty`);
  const subTopicIds = new Map(item.subTopics.map((s) => [s.name, s.id]));
  const now = new Date();

  const set = await db.$transaction(async (tx) =>
    tx.questionSet.create({
      data: {
        watchItemId,
        kind: "fresh",
        number: await nextSetNumber(tx, watchItemId),
        runId,
        startedAt: options.today ?? now,
        lockedAt: now,
        model: generated.model,
        modelRegistryId: generated.modelRegistryId,
        promptVersion: generated.promptVersion,
        costUsd: generated.costUsd,
        generation: generationJson(generated),
        questions: { create: questionRows(generated.questions, subTopicIds) },
      },
      include: { questions: { orderBy: { position: "asc" } } },
    })
  );

  return {
    locked,
    fresh: set.questions.map((q) => toSnapshotQuestion(set, q)),
    promoted: promotions,
    freshSetNumber: set.number,
    costUsd: generated.costUsd,
  };
}

function toSnapshotQuestion(
  set: { number: number; kind: QuestionSetKind },
  q: { id: string; position: number; text: string; subTopicId: string | null; concern: string | null }
): SnapshotQuestion {
  return {
    id: q.id,
    label: questionLabel(set.number, q.position),
    text: q.text,
    setKind: set.kind,
    setNumber: set.number,
    subTopicId: q.subTopicId,
    concern: q.concern,
  };
}
