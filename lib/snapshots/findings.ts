/**
 * What one answer said, reduced to the findings a snapshot compares
 * (PROJECT-PLAN §4C): canonical entities, themes, cited domains, which side
 * its arguments lean to, and its tone. Every finding is a string key, so
 * agreement and shares work the same way for each kind.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import type { ProviderId } from "@/lib/answers";

export const METRICS = ["entity", "theme", "domain", "side", "tone"] as const;
export type Metric = (typeof METRICS)[number];

/** One answer's findings. Only answers that were answered and extracted count. */
export interface AnswerFindings {
  answerId: string;
  questionId: string;
  /** "1.3": set 1, position 3. */
  questionLabel: string;
  /** Anchor and promoted questions are asked every snapshot; fresh ones once. */
  locked: boolean;
  provider: ProviderId;
  repeat: number;
  findings: Record<Metric, string[]>;
}

/** Display names for keys that aren't readable on their own (canonical entity ids). */
export type Labels = Record<string, string>;

/**
 * The per-answer balance of its arguments: one value, like tone, so it can be
 * compared across repeats and given a share.
 */
export function sideBalance(sides: ("for" | "against")[]): string {
  const forCount = sides.filter((s) => s === "for").length;
  const against = sides.length - forCount;
  if (sides.length === 0) return "no arguments";
  if (forCount > against) return "leans for";
  if (against > forCount) return "leans against";
  return "even";
}

export function entityKey(e: { canonicalEntityId: string | null; normalized: string }): string {
  return e.canonicalEntityId ? `c:${e.canonicalEntityId}` : `n:${e.normalized}`;
}

const uniq = (xs: string[]) => [...new Set(xs)].sort();

/** Load a run's answers as findings, with labels for entity keys. */
export async function loadFindings(db: PrismaClient, runId: string): Promise<{ answers: AnswerFindings[]; labels: Labels }> {
  const rows = await db.answer.findMany({
    where: { runId, errorKind: null, questionId: { not: null }, extraction: { errorMessage: null } },
    select: {
      id: true,
      questionId: true,
      provider: true,
      repeat: true,
      questionRef: { select: { position: true, set: { select: { kind: true, number: true } } } },
      citations: { select: { domain: true, cited: true } },
      extraction: {
        select: {
          tone: true,
          entities: { select: { canonicalEntityId: true, normalized: true, name: true, canonical: { select: { name: true } } } },
          themes: { select: { normalized: true } },
          arguments: { select: { side: true } },
        },
      },
    },
  });
  const labels: Labels = {};
  const answers: AnswerFindings[] = [];
  for (const r of rows) {
    if (!r.extraction || !r.questionRef || !r.questionId) continue;
    for (const e of r.extraction.entities) {
      const key = entityKey(e);
      labels[key] ??= e.canonical?.name ?? e.name;
    }
    answers.push({
      answerId: r.id,
      questionId: r.questionId,
      questionLabel: `${r.questionRef.set.number}.${r.questionRef.position}`,
      locked: r.questionRef.set.kind !== "fresh",
      provider: r.provider as ProviderId,
      repeat: r.repeat,
      findings: {
        entity: uniq(r.extraction.entities.map(entityKey)),
        theme: uniq(r.extraction.themes.map((t) => t.normalized)),
        // Sources the answer cited, or that the API doesn't say were only looked at.
        domain: uniq(r.citations.filter((c) => c.cited !== false).map((c) => c.domain)),
        side: [sideBalance(r.extraction.arguments.map((a) => a.side))],
        tone: r.extraction.tone ? [r.extraction.tone] : [],
      },
    });
  }
  return { answers, labels };
}
