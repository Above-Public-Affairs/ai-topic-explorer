/**
 * Model watcher (task 4.5): check each provider's free-tier default model,
 * update the model list on a clear change, log it as an event and run the
 * anchor questions on both models. Runs as the Railway cron service
 * "model-watcher" daily at 13:00 UTC; see lib/watchers/models.ts.
 *
 *   npm run worker:models
 *   npm run worker:models -- --providers claude,gemini
 *   npm run worker:models -- --simulate gemini=gemini-3.5-flash   (local database only)
 *
 * `--simulate` stands in a check that reports the given model as the new
 * free default, quoted from the provider's current source page, to prove the
 * switch path end to end. It refuses to run against anything but localhost.
 *
 * Env: DATABASE_URL and the four AI keys (Railway references to the web
 * service), ERROR_API_URL / ERROR_API_KEY, optional MODEL_CHECK_CAP_USD
 * (default 1) and MODEL_SWITCH_CAP_USD (default 12). Migrations stay with the
 * web service.
 */
import { flush, initErrorReporter, reportError } from "@above-public-affairs/error-reporter";
import type { ProviderId } from "@/lib/answers";
import { PROVIDER_IDS } from "@/lib/answers/registry";
import { prisma } from "@/lib/db";
import { capFromEnv } from "@/lib/worker/weekly";
import { DEFAULT_CHECK_CAP_USD, DEFAULT_SWITCH_CAP_USD, runModelWatcher, type ModelWatcherOptions } from "@/lib/watchers/models";
import { askFreeTierDefault, fetchPage } from "@/lib/watchers/models-check";

initErrorReporter({ project: "ai-topic-explorer" });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function simulation(spec: string): Pick<ModelWatcherOptions, "check" | "fetchPage"> {
  if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? "")) throw new Error("--simulate runs only against a local database");
  const [provider, modelId] = spec.split("=") as [ProviderId, string];
  if (!PROVIDER_IDS.includes(provider) || !modelId) throw new Error(`--simulate wants provider=model-id, got "${spec}"`);
  const quote = `Simulated for the task 4.5 proof: free accounts now use ${modelId} by default.`;
  let evidenceUrl = "";
  return {
    check: async (p, current) => {
      if (p !== provider) return askFreeTierDefault(p, current);
      evidenceUrl = current.sourceUrl ?? "";
      return {
        report: { sameAsCurrent: false, consumerName: modelId, apiModelId: modelId, mappingIsGuess: false, evidenceUrl, evidenceQuote: quote, effectiveDate: "", notes: "simulated" },
        costUsd: 0,
        searches: 0,
        sources: [],
        model: "simulated",
      };
    },
    fetchPage: async (url, signal) => (url === evidenceUrl ? `<html><body><p>${quote}</p></body></html>` : fetchPage(url, signal)),
  };
}

async function main(): Promise<number> {
  const checkCapUsd = capFromEnv(process.env.MODEL_CHECK_CAP_USD, DEFAULT_CHECK_CAP_USD);
  const switchCapUsd = capFromEnv(process.env.MODEL_SWITCH_CAP_USD, DEFAULT_SWITCH_CAP_USD);
  const providers = arg("providers")?.split(",").map((p) => p.trim()) as ProviderId[] | undefined;
  const simulate = arg("simulate");
  const started = Date.now();
  console.log(`Model watcher: check cap $${checkCapUsd}, switch cap $${switchCapUsd}${simulate ? `, SIMULATING ${simulate}` : ""}`);

  const result = await runModelWatcher(prisma, {
    providers,
    checkCapUsd,
    switchCapUsd,
    askConcurrency: 8,
    ...(simulate ? simulation(simulate) : {}),
    log: (line) => console.log(line),
  });

  for (const p of result.providers) {
    const operation = "worker:model-watcher";
    if (p.outcome === "changed" || p.outcome === "resumed") {
      const s = p.switch!;
      // An info-level heads-up so Josh hears about it; proper alerts are 5.2.
      reportError({
        category: "model_change",
        level: "info",
        message: `${p.provider} free-tier default ${p.outcome === "changed" ? "changed" : "switch resumed"}: ${s.oldModel} → ${s.newModel}. Both-models runs: ${s.items.filter((i) => i.outcome === "ran").length} of ${s.items.length} items, $${s.costUsd.toFixed(2)}.`,
        operation,
        context: { eventId: p.eventId, items: s.items.map(({ name, runId, status, outcome, reason, oldAnswered, newAnswered, questions }) => ({ name, runId, status, outcome, reason, oldAnswered, newAnswered, questions })) },
      });
      const bad = s.items.filter((i) => i.outcome === "failed" || (i.outcome === "skipped" && i.reason?.startsWith("switch cap")) || (i.outcome === "ran" && i.status !== "complete"));
      if (bad.length) {
        reportError({
          category: "model_change",
          level: "warning",
          message: `${p.provider} switch ${s.oldModel} → ${s.newModel}: ${bad.length} item run(s) incomplete (${bad.map((i) => `${i.name}: ${i.reason ?? i.status}`).join("; ")})`,
          operation,
          context: { eventId: p.eventId },
        });
      }
    } else if (p.outcome === "unclear") {
      reportError({
        category: "model_check",
        level: "warning",
        message: `${p.provider} free-tier default unclear, list left as ${p.model}: ${p.reason}. Check by hand.`,
        operation,
      });
    } else if (p.outcome === "failed") {
      reportError({ category: "model_check", message: `Model check failed for ${p.provider}: ${p.reason}`, rawError: p.error, operation });
    } else if (p.outcome === "skipped" && p.reason?.startsWith("daily check cap")) {
      reportError({ category: "model_check", level: "warning", message: `Model check skipped for ${p.provider}: ${p.reason}`, operation });
    }
  }

  const count = (o: string) => result.providers.filter((p) => p.outcome === o).length;
  console.log(
    `Done in ${Math.round((Date.now() - started) / 1000)}s: ${count("unchanged")} unchanged, ${count("changed")} changed, ${count("resumed")} resumed, ` +
      `${count("unclear")} unclear, ${count("skipped")} skipped, ${count("failed")} failed. ` +
      `Check cost $${result.checkCostUsd.toFixed(4)} of $${result.checkCapUsd}; switch cost $${result.switchCostUsd.toFixed(2)} of $${result.switchCapUsd}.`
  );
  return count("failed") > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err);
    reportError({ category: "crash", level: "fatal", message: `Model watcher crashed: ${err instanceof Error ? err.message : String(err)}`, rawError: err, operation: "worker:model-watcher" });
    process.exitCode = 1;
  })
  .finally(async () => {
    await flush();
    await prisma.$disconnect();
    // A cron service must exit, or Railway skips the next run.
    process.exit(process.exitCode ?? 0);
  });
