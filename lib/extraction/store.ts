import type { PrismaClient } from "@/app/generated/prisma/client";
import { getExtractionModel } from "@/lib/answers/registry";
import { extractAnswer, type ExtractionInput, type ResponsesClient } from "./extract";
import { linkThemes } from "@/lib/themes/link";
import { linkEntities } from "./link";
import { extractedCitationRows, extractionCreateData } from "./map";
import { PROMPT_VERSION } from "./schema";
import { FAILED_EXTRACTION_ESTIMATE_USD } from "@/lib/answers/estimates";

export interface ExtractAndStoreResult {
  extractionId: string;
  ok: boolean;
  costUsd: number;
  error?: string;
}

/**
 * Extract one stored answer and write the Extraction (with its entities,
 * themes and arguments) and any extracted citations, then merge its
 * entities into the canonical entity list (link.ts) and link its themes to
 * known themes (lib/themes, alias step only). A failed extraction is
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
  let settings: Awaited<ReturnType<typeof getExtractionModel>> | null = null;
  // Set once the extraction model has answered: from then on the call is paid
  // for, whatever happens to the database write (task 6.6, code review L2).
  let paidUsd: number | null = null;
  try {
    settings = await getExtractionModel();
    const out = await extractAnswer({ ...input, answer: answer.answer }, { ...options, settings });
    paidUsd = out.costUsd;
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
    if (out.result.themes.length) {
      // Known labels only (no AI call); the snapshot maps the rest in one batch.
      try {
        await linkThemes(db, { extractionIds: [extraction.id], map: false });
      } catch (err) {
        console.warn(`[Extraction] Theme link failed for ${extraction.id}; left unlinked. ${err instanceof Error ? err.message : err}`);
      }
    }
    return { extractionId: extraction.id, ok: true, costUsd: out.costUsd };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A failed call was usually billed too (security review L1), so it's
    // counted at a small estimate rather than nothing. Without the model's
    // settings nothing was sent.
    const costUsd = paidUsd ?? (settings ? FAILED_EXTRACTION_ESTIMATE_USD : 0);
    const failed = await db.extraction
      .create({
        data: {
          answerId: answer.id,
          model: settings?.model ?? "unknown",
          modelRegistryId: settings?.registryId ?? null,
          promptVersion: PROMPT_VERSION,
          costUsd,
          errorMessage: message.slice(0, 2000),
        },
        select: { id: true },
      })
      // Even the failure couldn't be stored: still report what it cost.
      .catch((dbErr) => ({ id: "", dbError: dbErr instanceof Error ? dbErr.message : String(dbErr) }));
    const note = "dbError" in failed ? `${message}; not stored: ${failed.dbError}` : message;
    return { extractionId: failed.id, ok: false, costUsd, error: note };
  }
}
