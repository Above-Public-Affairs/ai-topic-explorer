import type { PrismaClient } from "@/app/generated/prisma/client";
import { extractAndStore, linkEntities, relinkAllEntities, type ResponsesClient } from "@/lib/extraction";

/**
 * Extract every stored answer that has text but no Extraction row yet (for
 * example after a crash mid-run), then link any entity still not merged
 * into a canonical entity. Returns how many were extracted and linked.
 */
export async function extractMissing(
  db: PrismaClient,
  options: { limit?: number; client?: ResponsesClient } = {}
): Promise<{ extracted: number; failed: number; costUsd: number; linked: number }> {
  const answers = await db.answer.findMany({
    where: { answer: { not: null }, extraction: null },
    select: {
      id: true,
      answer: true,
      question: true,
      run: { select: { topic: true } },
      citations: { select: { url: true, origin: true } },
    },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 200,
  });
  let failed = 0;
  let costUsd = 0;
  for (const a of answers) {
    const res = await extractAndStore(
      db,
      {
        id: a.id,
        answer: a.answer!,
        providerUrls: a.citations.map((c) => c.url),
        nextCitationPosition: a.citations.length,
      },
      { topic: a.run.topic, question: a.question },
      { client: options.client }
    );
    if (!res.ok) failed++;
    costUsd += res.costUsd;
  }
  const { linked } = await linkEntities(db);
  return { extracted: answers.length - failed, failed, costUsd, linked };
}

/**
 * Re-run entity merging over everything stored (task 2.7): rebuild the
 * canonical entity list from scratch with the current rules. Returns entity
 * and canonical-entity counts before and after.
 */
export async function remergeEntities(
  db: PrismaClient
): Promise<{ entities: number; before: number; after: number; merged: number; skipped: number }> {
  const [entities, before] = await Promise.all([db.entity.count(), db.canonicalEntity.count()]);
  const res = await relinkAllEntities(db);
  const after = await db.canonicalEntity.count();
  return { entities, before, after, merged: res.merged, skipped: res.skipped };
}
