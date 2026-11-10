/**
 * Notable-change alerts by hand (task 5.2). The workers call afterSnapshot()
 * themselves; this is for proofs, reruns and test sends.
 *
 *   npm run alerts -- --list [--limit=20]                  recent alerts
 *   npm run alerts -- --run=<runId>                         make (and, with ALERTS_ENABLED=true, send) a run's alerts; safe to repeat
 *   npm run alerts -- --show=A-12 [--html=<file>]           print the email, or write its HTML to a file
 *   railway run npm run alerts -- --send-test=A-12 [--to=<email>]   send one stored alert as a test ("[Test]" subject); its status doesn't change
 *   DATABASE_URL=<local> npm run alerts -- --compare=<beforeRunId>,<afterRunId>   store a comparison on the later run (local proofs only)
 *   npm run alerts -- --withdraw=A-1,A-2 --reason="<why>"   mark unreliable alerts withdrawn: kept, never sent or reported (4.9)
 *
 * Writes to a non-local database (--run, --withdraw) need --yes-production.
 */
import { writeFileSync } from "node:fs";
import { flush, initErrorReporter } from "@above-public-affairs/error-reporter";
import { prisma } from "@/lib/db";
import { afterSnapshot, alertCode, emailFor, renderHtml, renderText, sendAlert, withdrawAlerts } from "@/lib/alerts";
import { compareRuns, type SnapshotStats } from "@/lib/snapshots";

initErrorReporter({ project: "ai-topic-explorer" });

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string) => args.includes(`--${name}`);
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? "");

async function byCode(code: string) {
  const number = Number(code.replace(/^A-/i, ""));
  if (!Number.isInteger(number)) throw new Error(`Not an alert code: ${code}`);
  return prisma.alert.findUniqueOrThrow({ where: { number } });
}

async function main() {
  if (has("list")) {
    const rows = await prisma.alert.findMany({ orderBy: { number: "desc" }, take: Number(flag("limit") ?? 20) });
    for (const r of rows) console.log(`${alertCode(r.number).padEnd(6)} ${r.status.padEnd(10)} ${r.createdAt.toISOString().slice(0, 16)}  ${r.subject}`);
    if (!rows.length) console.log("No alerts yet.");
    return;
  }
  const compare = flag("compare");
  if (compare) {
    if (!local) throw new Error("--compare writes run stats; local databases only.");
    const [beforeId, afterId] = compare.split(",");
    const comparison = await compareRuns(prisma, beforeId, afterId);
    const run = await prisma.run.findUniqueOrThrow({ where: { id: afterId }, select: { stats: true } });
    const stats = { ...(run.stats as unknown as SnapshotStats), comparison: { againstRunId: beforeId, ...comparison } };
    await prisma.run.update({ where: { id: afterId }, data: { stats: JSON.parse(JSON.stringify(stats)) } });
    console.log(`${afterId}: ${comparison.swings.length} swings vs ${beforeId} over ${comparison.questions} questions`);
    for (const s of comparison.swings.slice(0, 20)) console.log(`  ${s.scope.padEnd(7)} ${s.metric.padEnd(7)} ${s.kind.padEnd(5)} ${s.label}: ${(s.before * 100).toFixed(0)}% → ${(s.after * 100).toFixed(0)}% (band ${(s.threshold * 100).toFixed(1)} pts)`);
    return;
  }
  const runId = flag("run");
  if (runId) {
    if (!local && !has("yes-production")) throw new Error("DATABASE_URL isn't local. Add --yes-production to write alerts to it.");
    const r = await afterSnapshot(prisma, runId, { log: (l) => console.log(l) });
    if (r.error) process.exitCode = 1;
    for (const a of r.alerts) console.log(`  ${a.code} ${a.status}: ${a.subject}`);
    return;
  }
  const withdraw = flag("withdraw");
  if (withdraw) {
    if (!local && !has("yes-production")) throw new Error("DATABASE_URL isn't local. Add --yes-production to withdraw alerts in it.");
    const numbers = withdraw.split(",").map((c) => Number(c.trim().replace(/^A-/i, "")));
    if (numbers.some((n) => !Number.isInteger(n))) throw new Error(`Not a list of alert codes: ${withdraw}`);
    for (const r of await withdrawAlerts(prisma, numbers, flag("reason") ?? "")) console.log(`  ${alertCode(r.number)} ${r.outcome} (was ${r.from})`);
    return;
  }
  const show = flag("show");
  if (show) {
    const alert = await byCode(show);
    const html = flag("html");
    if (html) {
      writeFileSync(html, renderHtml(emailFor(alert)));
      console.log(`Wrote ${html}`);
    } else console.log(renderText(emailFor(alert)));
    console.log(`\nstatus ${alert.status}, writer ${alert.writer}, $${alert.costUsd.toFixed(5)}${alert.note ? `, note: ${alert.note}` : ""}`);
    return;
  }
  const test = flag("send-test");
  if (test) {
    const alert = await byCode(test);
    if (alert.status === "withdrawn") throw new Error(`${alertCode(alert.number)} was withdrawn as unreliable; not sending it, even as a test. ${alert.note ?? ""}`);
    const to = flag("to");
    const sent = await sendAlert(alert, { subjectPrefix: "[Test] ", ...(to ? { recipients: [to] } : {}) });
    console.log(`Sent ${alertCode(alert.number)} as a test at ${sent.sentAt.toISOString()}, SendGrid id ${sent.messageId ?? "?"}`);
    return;
  }
  console.log("Nothing to do. See the usage at the top of scripts/alerts.ts.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await flush();
    await prisma.$disconnect();
  });
