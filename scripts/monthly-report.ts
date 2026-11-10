/**
 * Monthly health report (task 5.3). Runs as the Railway cron service
 * "monthly-report" (1st of the month, 14:00 UTC) for the month just ended;
 * see lib/reports/monthly.ts for the history wait, the on/off switch and the
 * once-a-month guard.
 *
 *   npm run report:monthly                         # cron mode
 *   npm run report:monthly -- --month=2026-12      # a given month (still once per month)
 *   npm run report:monthly -- --sample --out=.reports/sample
 *   npm run report:monthly -- --sample --send-to=joshua@abovepublicaffairs.com
 *   npm run report:monthly -- --preview --month=2026-12 --out=.reports/dec   # real data to files, nothing sent
 *
 * Env: DATABASE_URL and OPENAI_API_KEY (Railway references to the web
 * service), SENDGRID_API_KEY / SENDGRID_FROM, ERROR_API_URL / ERROR_API_KEY,
 * REPORTS_ENABLED ("true" to send; off by default), REPORT_RECIPIENTS
 * (comma-separated; defaults to Josh).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { flush, initErrorReporter, reportError } from "@above-public-affairs/error-reporter";
import { sendEmail } from "@/lib/email/send";
import { monthFromKey } from "@/lib/reports/month";
import { buildReport, enabledFromEnv, readiness, recipientsFromEnv, runMonthlyReport, type BuiltReport } from "@/lib/reports/monthly";
import { SAMPLE_MONTH, sampleMonth } from "@/lib/reports/sample";

initErrorReporter({ project: "ai-topic-explorer" });

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");
const flag = (name: string) => process.argv.includes(`--${name}`);

function writeFiles(built: BuiltReport, dir: string): string {
  mkdirSync(dir, { recursive: true });
  for (const a of built.attachments) writeFileSync(path.join(dir, a.filename), a.content);
  // The preview inlines the cid: images so it opens anywhere (email clients get real cid: attachments).
  let html = built.html;
  for (const a of built.attachments) html = html.replaceAll(`cid:${a.contentId}`, `data:image/png;base64,${a.content.toString("base64")}`);
  const file = path.join(dir, "report.html");
  writeFileSync(file, html);
  writeFileSync(path.join(dir, "report.txt"), built.text);
  return file;
}

async function main(): Promise<number> {
  if (flag("sample")) {
    const inputs = sampleMonth();
    const built = await buildReport(monthFromKey(SAMPLE_MONTH), inputs, [], { sample: true });
    const kb = Math.round(built.attachments.reduce((n, a) => n + a.content.length, 0) / 1024);
    console.log(`Sample report built: ${built.report.items.length} items, ${built.attachments.length} charts (${kb} KB), summary by ${built.report.summary.source}${built.report.summary.note ? ` (${built.report.summary.note})` : ""}, $${built.report.summary.costUsd.toFixed(4)}`);
    const out = arg("out");
    if (out) console.log(`Wrote ${writeFiles(built, out)}`);
    const to = arg("send-to");
    if (to) {
      const sent = await sendEmail({ to: to.split(","), subject: built.subject, text: built.text, html: built.html, attachments: built.attachments }, { kind: "monthly-report-sample" });
      console.log(`Sample sent, SendGrid message ${sent.messageId}`);
    }
    return 0;
  }

  const { prisma } = await import("@/lib/db");
  try {
    if (flag("preview")) {
      const month = monthFromKey(arg("month") ?? "");
      const { loadItemMonth } = await import("@/lib/reports/load");
      const { ready, skipped } = await readiness(prisma, month);
      for (const s of skipped) console.log(`${s.name}: ${s.reason}`);
      if (!ready.length) return 0;
      const inputs = await Promise.all(ready.map((r) => loadItemMonth(prisma, r.id, month)));
      const built = await buildReport(month, inputs, skipped);
      console.log(`Wrote ${writeFiles(built, arg("out") ?? path.join(".reports", month.key))}`);
      return 0;
    }

    const month = arg("month") ? monthFromKey(arg("month")!) : undefined;
    const result = await runMonthlyReport(prisma, {
      month,
      enabled: enabledFromEnv(process.env.REPORTS_ENABLED),
      recipients: recipientsFromEnv(process.env.REPORT_RECIPIENTS),
      log: (line) => console.log(line),
    });
    if (result.outcome === "sent" && result.summarySource === "fallback") {
      reportError({ category: "report_error", level: "warning", message: `Monthly report ${result.month.key}: summary fell back to code`, operation: "worker:monthly-report" });
    }
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err);
    reportError({ category: "report_error", level: "error", message: `Monthly report failed: ${err instanceof Error ? err.message : String(err)}`, rawError: err, operation: "worker:monthly-report" });
    process.exitCode = 1;
  })
  .finally(async () => {
    await flush();
    // A cron service must exit, or Railway skips the next run.
    process.exit(process.exitCode ?? 0);
  });
