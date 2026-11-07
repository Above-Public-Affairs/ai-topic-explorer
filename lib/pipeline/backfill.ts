import type { PrismaClient } from "@/app/generated/prisma/client";
import { extractAndStore, type ResponsesClient } from "@/lib/extraction";

/**
 * Extract every stored answer that has text but no Extraction row yet (for
 * example after a crash mid-run). Returns how many were extracted.
 */
export async function extractMissing(
  db: PrismaClient,
  options: { limit?: number; client?: ResponsesClient } = {}
): Promise<{ extracted: number; failed: number; costUsd: number }> {
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
  return { extracted: answers.length - failed, failed, costUsd };
}
