/**
 * Write the free-tier model list (FREE_TIER_DEFAULTS in
 * lib/answers/registry.ts) to the ModelRegistry table, then print the
 * current rows. Safe to re-run: an unchanged model only refreshes its
 * confirmation; a changed one retires the old row and adds a new one.
 *
 *   railway run npm run models:seed            (writes, then prints)
 *   railway run npm run models:seed -- --show  (prints only)
 *
 * Production is seeded by migration 20261107180000_seed_model_registry. Prod
 * Postgres has no public proxy, so from a laptop this only reaches a local
 * or copied database (DATABASE_URL=...); run it on Railway (`railway ssh`)
 * to write production.
 */
import { FREE_TIER_DEFAULTS, PROVIDER_IDS, saveModel } from "@/lib/answers/registry";
import { prisma } from "@/lib/db";

async function main() {
  if (!process.argv.includes("--show")) {
    for (const provider of PROVIDER_IDS) {
      const r = await saveModel(FREE_TIER_DEFAULTS[provider]);
      console.log(
        `${provider}: ${r.action} ${FREE_TIER_DEFAULTS[provider].model} (${r.id})${r.retiredId ? `, retired ${r.retiredId}` : ""}`
      );
    }
  }
  const rows = await prisma.modelRegistry.findMany({
    where: { retiredAt: null },
    orderBy: { provider: "asc" },
  });
  console.log("\nCurrent model registry:");
  console.table(
    rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      effort: r.effortLevel,
      search: r.searchSetting,
      location: r.locationMode,
      confirmed: r.confirmedAt.toISOString().slice(0, 10),
      guess: r.isGuess,
      source: r.sourceUrl,
    }))
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
