import type { PrismaClient } from "@/app/generated/prisma/client";
import { getExtractionModel } from "@/lib/answers/registry";
import { extractAnswer, type ExtractionInput, type ResponsesClient } from "./extract";
import { linkEntities } from "./link";
import { extractedCitationRows, extractionCreateData } from "./map";
import { PROMPT_VERSION } from "./schema";

export interface ExtractAndStoreResult {
  extractionId: string;
  ok: boolean;
  costUsd: number;
  error?: string;
}

/**
 * Extract one stored answer and write the Extraction (with its entities,
 * themes and arguments) and any extracted citations, then merge its
 * entities into the canonical entity list (link.ts). A failed extraction is
 * stored too, with errorMessage set, so every answer has an Extraction row.
 * A failed merge only logs: the entities stay unlinked until the next
 * linkEntities() call picks them up.
 */
export async function extractAndStore(
  db: PrismaClient,
  answer: { id: string; answer: string; providerUrls: string[]; nextCitationPosition: number },
  input: Omit<ExtractionInput, "answer">,
  options: { subTopicIds?: Record<string, string>; client?: ResponsesClient; signal?: AbortSignal } = {}
): Promise<ExtractAndStoreResult> {
  const settings = await getExtractionModel();
  try {
    const out = await extractAnswer({ ...input, answer: answer.answer }, { ...options, settings });
    const citations = extractedCitationRows(answer.answer, out.result, answer.providerUrls, answer.nextCitationPosition);
    const extraction = await db.$transaction(async (tx) => {
      const created = await tx.extraction.create({
        data: extractionCreateData(answer.id, out.result, out, options.subTopicIds),
        select: { id: true },
      });
      if (citations.length) {
        await tx.citation.createMany({ data: citations.map((c) => ({ ...c, answerId: answer.id })) });
      }
      return created;
    });
    if (out.result.entities.length) {
      try {
        await linkEntities(db, { extractionIds: [extraction.id] });
      } catch (err) {
        console.warn(`[Extraction] Entity merge failed for ${extraction.id}; left unlinked. ${err instanceof Error ? err.message : err}`);
      }
    }
    return { extractionId: extraction.id, ok: true, costUsd: out.costUsd };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await db.extraction.create({
      data: {
        answerId: answer.id,
        model: settings.model,
        modelRegistryId: settings.registryId,
        promptVersion: PROMPT_VERSION,
        errorMessage: message.slice(0, 2000),
      },
      select: { id: true },
    });
    return { extractionId: failed.id, ok: false, costUsd: 0, error: message };
  }
}
