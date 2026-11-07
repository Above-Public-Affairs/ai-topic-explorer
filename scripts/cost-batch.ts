/**
 * Task 2.6: run a small batch of voter-style questions through the pipeline
 * and report real cost per answer per provider against the plan's estimate.
 *
 *   railway run -- env DATABASE_URL=postgresql://postgres@127.0.0.1:55436/ate npx tsx scripts/cost-batch.ts
 *
 * Refuses to run against anything but a local database. Questions run one at
 * a time and the batch stops once the running total passes --cap (default $2.50).
 * --report-only skips asking and reports on what the database already holds.
 */
import { prisma } from "@/lib/db";
import type { ProviderId, UserLocation } from "@/lib/answers";
import { runPipeline } from "@/lib/pipeline/run";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CAP = Number(flag("cap") ?? 2.5);
const NOTE = "task 2.6 cost batch";

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(dbUrl)) {
  console.error("DATABASE_URL must point at a local database for this script.");
  process.exit(1);
}

const AUSTIN: UserLocation = { city: "Austin", region: "Texas", country: "US", timezone: "America/Chicago" };
const ALBUQUERQUE: UserLocation = { city: "Albuquerque", region: "New Mexico", country: "US", timezone: "America/Denver" };

const BATCH: { topic: string; location: UserLocation; question: string; repeats: number }[] = [
  { topic: "Data centers in Texas", location: AUSTIN, question: "Are data centers raising my electricity bill?", repeats: 2 },
  { topic: "Data centers in Texas", location: AUSTIN, question: "How much water do the data centers being built near me use?", repeats: 1 },
  { topic: "Data centers in Texas", location: AUSTIN, question: "Do data centers bring good jobs to Texas towns?", repeats: 1 },
  { topic: "Oil and gas in New Mexico", location: ALBUQUERQUE, question: "How much of New Mexico's school funding comes from oil and gas?", repeats: 2 },
  { topic: "Oil and gas in New Mexico", location: ALBUQUERQUE, question: "Is fracking in the Permian Basin making the air worse here?", repeats: 1 },
  { topic: "Oil and gas in New Mexico", location: ALBUQUERQUE, question: "Should New Mexico slow down new oil and gas drilling?", repeats: 1 },
  { topic: "Renewables in Texas", location: AUSTIN, question: "Did wind and solar help or hurt the Texas grid during the last big freeze?", repeats: 1 },
  { topic: "Renewables in Texas", location: AUSTIN, question: "Are solar farms good for Texas landowners and rural counties?", repeats: 1 },
];

const ESTIMATE: Record<ProviderId, number> = { claude: 0.048, grok: 0.023, openai: 0.021, gemini: 0.003 };

async function ask() {
  let total = 0;
  for (const item of BATCH) {
    for (let repeat = 1; repeat <= item.repeats; repeat++) {
      if (total >= CAP) {
        console.log(`Stopping: total $${total.toFixed(4)} reached the $${CAP} cap.`);
        return;
      }
      const r = await runPipeline(prisma, {
        kind: "manual",
        topic: item.topic,
        questions: [{ text: item.question, repeat }],
        location: item.location,
        note: NOTE,
      });
      total += r.costUsd;
      const parts = r.answers.map(
        (a) => `${a.provider} ${a.ok ? "$" + a.answerCostUsd.toFixed(4) : "FAILED " + a.error}`
      );
      console.log(`[$${total.toFixed(4)}] ${r.status} | ${item.question} (#${repeat}) | ${parts.join(", ")}`);
    }
  }
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const median = s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0;
  return { n: xs.length, mean, median, min: s[0] ?? 0, max: s[s.length - 1] ?? 0 };
};
const f = (x: number) => "$" + x.toFixed(4);

async function report() {
  const answers = await prisma.answer.findMany({
    where: { run: { note: NOTE } },
    include: { extraction: true, run: { select: { topic: true } } },
  });
  console.log(`\n${answers.length} answers stored for "${NOTE}".`);

  const providers: ProviderId[] = ["claude", "openai", "gemini", "grok"];
  let perQuestion = 0;
  console.log("\nprovider | ok/n | mean | median | min | max | estimate | source | model | avg in/out tok | avg searches | tokens$ / search$");
  for (const p of providers) {
    const rows = answers.filter((a) => a.provider === p);
    const ok = rows.filter((a) => a.answer);
    const st = stats(ok.map((a) => a.costUsd));
    perQuestion += st.mean;
    const avg = (k: (a: (typeof ok)[number]) => number) => ok.reduce((s, a) => s + k(a), 0) / (ok.length || 1);
    const sources = [...new Set(ok.map((a) => a.costSource))].join(",");
    const models = [...new Set(ok.map((a) => a.model))].join(",");
    console.log(
      [p, `${ok.length}/${rows.length}`, f(st.mean), f(st.median), f(st.min), f(st.max), f(ESTIMATE[p]), sources, models,
        `${Math.round(avg((a) => a.inputTokens))}/${Math.round(avg((a) => a.outputTokens))}`,
        avg((a) => a.searchCalls).toFixed(2),
        `${f(avg((a) => a.costTokensUsd ?? 0))} / ${f(avg((a) => a.costSearchUsd ?? 0))}`].join(" | ")
    );
    for (const a of rows.filter((x) => !x.answer)) console.log(`   failed: ${a.errorKind} ${a.errorMessage?.slice(0, 120)}`);
  }

  const ex = answers.map((a) => a.extraction).filter((e) => e && !e.errorMessage) as NonNullable<(typeof answers)[number]["extraction"]>[];
  const exStats = stats(ex.map((e) => e.costUsd));
  const exModels = [...new Set(ex.map((e) => e.model))].join(",");
  const failedEx = answers.filter((a) => a.extraction?.errorMessage).length;
  console.log(`\nextraction (${exModels}): n=${exStats.n}, failed ${failedEx}, mean ${f(exStats.mean)}, min ${f(exStats.min)}, max ${f(exStats.max)}`);

  const q = perQuestion + 4 * exStats.mean;
  console.log(`\nPer question (4 answers + 4 extractions): ${f(q)}  (answers only ${f(perQuestion)})`);
  console.log(`Per snapshot (32 questions): ${f(q * 32)}`);
  console.log(`Per month (19 snapshots): ${f(q * 32 * 19)}`);

  // Repeat variance
  const byQ = new Map<string, number[]>();
  for (const a of answers.filter((x) => x.answer)) {
    const k = `${a.provider} | ${a.question}`;
    byQ.set(k, [...(byQ.get(k) ?? []), a.costUsd]);
  }
  console.log("\nRepeated questions:");
  for (const [k, v] of byQ) if (v.length > 1) console.log(`  ${k}: ${v.map(f).join(", ")}`);

  // Grok cross-check: reported charge vs. list-price tokens + searches
  const grok = answers.filter((a) => a.provider === "grok" && a.answer);
  if (grok.length) {
    const listPrice = (a: (typeof grok)[number]) =>
      ((a.inputTokens - a.cachedInputTokens) * 1.25 + a.cachedInputTokens * 0.2 + a.outputTokens * 2.5) / 1e6 + a.searchCalls * 0.005;
    console.log(`\nGrok reported mean ${f(stats(grok.map((a) => a.costUsd)).mean)} vs list-price recompute ${f(stats(grok.map(listPrice)).mean)}`);
  }
  const runs = await prisma.run.aggregate({ where: { note: NOTE }, _sum: { costUsd: true }, _count: true });
  console.log(`\nRuns: ${runs._count}, total recorded spend ${f(runs._sum.costUsd ?? 0)}`);
}

async function main() {
  if (!args.includes("--report-only")) await ask();
  await report();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
