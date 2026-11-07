/**
 * Ask all four providers one question with a Texas location and print each
 * result. Uses real API keys and costs a few cents per run.
 *
 *   railway run npm run ask:providers -- "your question"
 *
 * Flags: --json prints the full results as JSON; --only=claude,grok limits
 * the providers.
 */
import { PROVIDERS, ProviderError, TEXAS_LOCATION, type AskResult, type ProviderId } from "@/lib/answers";

const args = process.argv.slice(2);
const json = args.includes("--json");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",") as
  | ProviderId[]
  | undefined;
const question =
  args.filter((a) => !a.startsWith("--")).join(" ") ||
  "Are data centers raising electricity bills in Texas?";

function print(r: AskResult) {
  const cited = r.sources.filter((s) => s.cited === true);
  const looked = r.sources.filter((s) => s.cited !== true);
  console.log(`\n=== ${r.provider} ===`);
  console.log(`model: ${r.model} (asked for ${r.requestedModel})`);
  console.log(`location: ${r.location ? `${r.location.city}, ${r.location.region}, ${r.location.country}` : "none"} [${r.locationMode}]`);
  console.log(`finish: ${r.finishReason}   latency: ${(r.latencyMs / 1000).toFixed(1)}s`);
  console.log(
    `tokens: in ${r.usage.inputTokens} (cached ${r.usage.cachedInputTokens}), out ${r.usage.outputTokens} (reasoning ${r.usage.reasoningTokens}), searches ${r.usage.searchCalls}`
  );
  const b = r.cost.breakdown;
  console.log(
    `cost: $${r.cost.usd.toFixed(5)} [${r.cost.source}]${b ? ` = tokens $${b.tokensUsd.toFixed(5)} + search $${b.searchUsd.toFixed(5)}` : ""}`
  );
  console.log(`queries (${r.searchQueries.length}): ${r.searchQueries.map((q) => JSON.stringify(q)).join(", ") || "none"}`);
  console.log(`sources: ${cited.length} cited, ${looked.length} only looked at`);
  for (const s of cited.slice(0, 8)) console.log(`  [cited] ${s.title ? `${s.title} — ` : ""}${s.url}`);
  for (const s of looked.slice(0, 4)) console.log(`  [looked${s.cited === null ? "?" : ""}] ${s.title ? `${s.title} — ` : ""}${s.url}`);
  const preview = r.answer.replace(/\s+/g, " ");
  console.log(`answer (${r.answer.length} chars): ${preview.slice(0, 400)}${preview.length > 400 ? "…" : ""}`);
}

async function main() {
  const ids = (only ?? (Object.keys(PROVIDERS) as ProviderId[])).filter((id) => id in PROVIDERS);
  console.log(`Question: ${question}`);
  const settled = await Promise.allSettled(
    ids.map((id) => PROVIDERS[id].ask(question, { location: TEXAS_LOCATION }))
  );
  const results: AskResult[] = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") results.push(s.value);
    else if (s.reason instanceof ProviderError)
      console.error(`\n=== ${ids[i]} FAILED [${s.reason.kind}] ===\n${s.reason.message}`);
    else console.error(`\n=== ${ids[i]} FAILED (untyped) ===\n${s.reason instanceof Error ? s.reason.stack : s.reason}`);
  });
  if (json) console.log(JSON.stringify(results, null, 2));
  else results.forEach(print);
  const total = results.reduce((sum, r) => sum + r.cost.usd, 0);
  console.log(`\nTotal cost: $${total.toFixed(5)} across ${results.length} answers`);
  if (results.length < ids.length) process.exitCode = 1;
}

main();
