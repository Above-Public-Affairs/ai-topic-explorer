/**
 * Run the new pipeline once: ask the providers one question with a Texas
 * location, store the Run, Answers and Citations, extract every answer, and
 * print row counts per table plus the extraction cost per answer. Uses real
 * API keys and the real database (a few cents per run).
 *
 *   railway run npm run pipeline:run -- "your question"
 *
 * Flags: --topic="..." sets the run topic (defaults to the question);
 * --only=claude,grok limits the providers; --backfill extracts stored answers
 * that have no extraction yet instead of running a new question.
 */
import { prisma } from "@/lib/db";
import { TEXAS_LOCATION, type ProviderId } from "@/lib/answers";
import { runPipeline } from "@/lib/pipeline/run";
import { extractMissing } from "@/lib/pipeline/backfill";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = flag("only")?.split(",") as ProviderId[] | undefined;
const question =
  args.filter((a) => !a.startsWith("--")).join(" ") || "Are data centers raising electricity bills in Texas?";
const topic = flag("topic") ?? question;

async function counts(runId: string) {
  const answerWhere = { runId };
  const extractionWhere = { answer: answerWhere };
  const [answers, withText, extractions, failedExtractions, citations, extractedCitations, entities, themes, args] =
    await Promise.all([
      prisma.answer.count({ where: answerWhere }),
      prisma.answer.count({ where: { ...answerWhere, answer: { not: null } } }),
      prisma.extraction.count({ where: extractionWhere }),
      prisma.extraction.count({ where: { ...extractionWhere, errorMessage: { not: null } } }),
      prisma.citation.count({ where: { answer: answerWhere } }),
      prisma.citation.count({ where: { answer: answerWhere, origin: "extracted" } }),
      prisma.entity.count({ where: { extraction: extractionWhere } }),
      prisma.theme.count({ where: { extraction: extractionWhere } }),
      prisma.argument.count({ where: { extraction: extractionWhere } }),
    ]);
  return { answers, withText, extractions, failedExtractions, citations, extractedCitations, entities, themes, arguments: args };
}

async function main() {
  if (args.includes("--backfill")) {
    console.log(await extractMissing(prisma));
    return;
  }
  console.log(`Question: ${question}`);
  const result = await runPipeline(prisma, {
    kind: "manual",
    topic,
    questions: [{ text: question }],
    location: TEXAS_LOCATION,
    providers: only,
    note: "task 2.3 proof run",
  });
  console.log(`\nRun ${result.runId}: ${result.status}, total $${result.costUsd.toFixed(5)}`);

  const rows = await prisma.answer.findMany({
    where: { runId: result.runId },
    select: {
      provider: true,
      model: true,
      costUsd: true,
      errorKind: true,
      _count: { select: { citations: true } },
      extraction: {
        select: {
          model: true,
          tone: true,
          framing: true,
          inputTokens: true,
          outputTokens: true,
          costUsd: true,
          errorMessage: true,
          _count: { select: { entities: true, themes: true, arguments: true } },
        },
      },
    },
    orderBy: { provider: "asc" },
  });
  for (const r of rows) {
    const e = r.extraction;
    console.log(`\n=== ${r.provider} (${r.model ?? "failed: " + r.errorKind}) answer $${r.costUsd.toFixed(5)} ===`);
    console.log(`citations: ${r._count.citations}`);
    if (!e) console.log("extraction: none");
    else if (e.errorMessage) console.log(`extraction FAILED: ${e.errorMessage}`);
    else {
      console.log(
        `extraction (${e.model}): ${e._count.entities} entities, ${e._count.themes} themes, ${e._count.arguments} arguments; tone ${e.tone}`
      );
      console.log(`  tokens in ${e.inputTokens}, out ${e.outputTokens}; cost $${e.costUsd.toFixed(6)}`);
      console.log(`  framing: ${e.framing}`);
    }
  }

  const c = await counts(result.runId);
  console.log("\nRows for this run:", c);
  const extracted = rows.filter((r) => r.extraction && !r.extraction.errorMessage);
  const extractionCost = extracted.reduce((s, r) => s + (r.extraction?.costUsd ?? 0), 0);
  if (extracted.length)
    console.log(
      `Extraction cost: $${extractionCost.toFixed(6)} total, $${(extractionCost / extracted.length).toFixed(6)} per answer`
    );
  if (c.extractions - c.failedExtractions < c.withText) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
