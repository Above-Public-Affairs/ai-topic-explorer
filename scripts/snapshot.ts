/**
 * Run or inspect watch-item snapshots (task 4.3). Local database only; the
 * weekly worker (4.4) runs production snapshots.
 *
 *   railway run -- env DATABASE_URL=<local> npm run snapshot -- --item="Data centers in Texas" [--repeats=3] [--cap=6]
 *   railway run -- env DATABASE_URL=<local> npm run snapshot -- --report=<runId> [--as-repeats=2]
 *   railway run -- env DATABASE_URL=<local> npm run snapshot -- --compare=<beforeRunId>,<afterRunId>
 *   DATABASE_URL=<local> npm run snapshot -- --restat=<runId>   (recompute stored stats after a method change; no AI calls)
 *
 * --cap stops asking once answer costs pass it (default $6). --as-repeats
 * recomputes a run's agreement and noise band from its first N repeats only,
 * to see what fewer repeats would have shown.
 */
import { prisma } from "@/lib/db";
import {
  METRICS,
  agreement,
  compareRuns,
  loadFindings,
  noiseBand,
  runSnapshot,
  snapshotStats,
  DEFAULT_REPEATS,
  type AgreementSummary,
  type SnapshotNoise,
  type SnapshotStats,
} from "@/lib/snapshots";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(dbUrl)) {
  console.error("DATABASE_URL must point at a local database for this script.");
  process.exit(1);
}

const pct = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);
const pts = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)} pts`);

function printAgreement(a: AgreementSummary) {
  console.log(`\nAgreement (${a.pairs} question × AI pairs judged, ${a.skipped} skipped)\n  ${a.rule}`);
  for (const m of METRICS) {
    const t = a.totals[m];
    console.log(`  ${m.padEnd(7)} held ${String(t.held).padStart(4)}  noisy ${String(t.noisy).padStart(4)}  held rate ${pct(a.heldRate[m])}`);
  }
}

function printNoise(noise: SnapshotNoise) {
  console.log(`\nNoise band (a change between snapshots must exceed this to be a swing; sigma = pass-to-pass spread)`);
  console.log(`  ${"scope".padEnd(8)}${METRICS.map((m) => m.padEnd(22)).join("")}`);
  for (const [scope, byMetric] of Object.entries(noise)) {
    const cells = METRICS.map((m) => {
      const n = byMetric![m];
      return `${pts(n.band)} (σ ${n.sigma == null ? "—" : (n.sigma * 100).toFixed(1)})`.padEnd(22);
    });
    console.log(`  ${scope.padEnd(8)}${cells.join("")}`);
  }
}

async function report(runId: string, asRepeats?: number) {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, select: { stats: true, costUsd: true, status: true, startedAt: true } });
  console.log(`Run ${runId} (${run.status}, ${run.startedAt.toISOString()}, $${(run.costUsd ?? 0).toFixed(2)})`);
  if (asRepeats) {
    const { answers } = await loadFindings(prisma, runId);
    const kept = answers.filter((a) => !a.locked || a.repeat <= asRepeats);
    console.log(`As if asked with ${asRepeats} repeats (${kept.filter((a) => a.locked).length} locked answers):`);
    printAgreement(agreement(kept));
    printNoise(noiseBand(kept));
    return;
  }
  const stats = run.stats as SnapshotStats | null;
  if (!stats) throw new Error("This run has no snapshot stats");
  console.log(`${stats.repeats} repeats; ${stats.answers.locked} locked + ${stats.answers.fresh} fresh answers usable`);
  if (stats.stoppedAtCapUsd) console.log(`STOPPED at the $${stats.stoppedAtCapUsd} cap`);
  printAgreement(stats.agreement);
  printNoise(stats.noise);
}

async function main() {
  const compare = flag("compare");
  if (compare) {
    const [before, after] = compare.split(",");
    const result = await compareRuns(prisma, before, after);
    console.log(`Compared ${result.questions} locked questions; ${result.swings.length} swings beyond the noise band:`);
    for (const s of result.swings) {
      console.log(
        `  ${s.scope.padEnd(7)} ${s.metric.padEnd(7)} ${s.kind.padEnd(5)} ${s.label.slice(0, 48).padEnd(48)} ${pct(s.before).padStart(6)} → ${pct(s.after).padStart(6)}  (${s.change > 0 ? "+" : ""}${(s.change * 100).toFixed(1)} vs band ${(s.threshold * 100).toFixed(1)}; n ${s.countBefore}→${s.countAfter})`
      );
    }
    return;
  }

  const restat = flag("restat");
  if (restat) {
    const run = await prisma.run.findUniqueOrThrow({ where: { id: restat }, select: { stats: true } });
    const old = run.stats as SnapshotStats | null;
    const stats = await snapshotStats(prisma, restat, old?.repeats ?? DEFAULT_REPEATS);
    if (old?.stoppedAtCapUsd) stats.stoppedAtCapUsd = old.stoppedAtCapUsd;
    await prisma.run.update({ where: { id: restat }, data: { stats: JSON.parse(JSON.stringify(stats)) } });
    return report(restat);
  }

  const reportId = flag("report");
  if (reportId) return report(reportId, flag("as-repeats") ? Number(flag("as-repeats")) : undefined);

  const name = flag("item");
  if (!name) throw new Error("Pass --item, --report or --compare");
  const item = await prisma.watchItem.findFirstOrThrow({ where: { name, active: true } });
  const cap = Number(flag("cap") ?? 6);
  let calls = 0;
  const started = Date.now();
  const result = await runSnapshot(prisma, item.id, {
    kind: "manual",
    repeats: flag("repeats") ? Number(flag("repeats")) : undefined,
    maxCostUsd: cap,
    askConcurrency: 12,
    note: "task 4.3 noise-band proof",
    onAnswer: (e) => {
      calls++;
      if (!e.ok) console.log(`  ✗ ${e.provider}: ${e.error.kind} ${e.error.message.slice(0, 80)}`);
      if (calls % 16 === 0) console.log(`  … ${calls} calls, ${Math.round((Date.now() - started) / 1000)}s`);
    },
  });
  const failed = result.pipeline.answers.filter((a) => !a.ok).length;
  console.log(`\nSnapshot ${result.runId}: ${result.pipeline.status}, ${result.pipeline.answers.length} calls (${failed} failed), $${result.costUsd.toFixed(2)}`);
  await report(result.runId);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
