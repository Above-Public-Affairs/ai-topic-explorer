/**
 * Theme merging (task 4.8): seed the vocabulary, link themes, review new ones.
 *
 *   npm run themes -- --seed                       write lib/themes/vocab.ts to the database
 *   npm run themes -- --link [--item=…] [--run=…] [--no-map]
 *                                                  link unlinked themes (alias table, then one mapper pass)
 *   npm run themes -- --relink [--item=…] [--forget-mapped]
 *                                                  clear links and link again; --forget-mapped re-asks the mapper
 *   npm run themes -- --groups [--item=…] [--limit=20]   themes with the most distinct wordings
 *   npm run themes -- --list-new [--item=…]        new themes waiting for review, most mentioned first
 *   npm run themes -- --merge=<fromSlug>:<intoSlug> --item=…   fold a theme into another
 *   npm run themes -- --restat=<runId>[,<runId>…]  recompute a snapshot's stored stats (no AI calls)
 *
 * Writes to a non-local database need --yes-production (the production
 * backfill: `--link --yes-production`, then `--restat=` the baseline runs).
 */
import { prisma } from "@/lib/db";
import { linkThemes, mergeThemes, relinkThemes, seedThemeVocab } from "@/lib/themes";
import { snapshotStats, type SnapshotStats } from "@/lib/snapshots";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string) => args.includes(`--${name}`);

const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(process.env.DATABASE_URL ?? "");
const writes = has("seed") || has("link") || has("relink") || !!flag("merge") || !!flag("restat");
if (writes && !local && !has("yes-production")) {
  console.error("DATABASE_URL isn't local. Add --yes-production to write to it.");
  process.exit(1);
}

async function itemIds(): Promise<{ id: string; name: string }[]> {
  const name = flag("item");
  const items = await prisma.watchItem.findMany({ where: name ? { name } : {}, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  if (name && !items.length) throw new Error(`No watch item named "${name}".`);
  return items;
}

async function main() {
  if (has("seed")) {
    for (const item of await itemIds()) {
      const r = await seedThemeVocab(prisma, item.id);
      console.log(`${item.name}: ${r.themes} vocabulary themes, ${r.aliases} aliases added.`);
    }
  }
  if (has("link") || has("relink")) {
    const items = flag("item") ? await itemIds() : [undefined];
    for (const item of items) {
      const r = has("relink")
        ? await relinkThemes(prisma, { watchItemId: item?.id, forgetMapped: has("forget-mapped") })
        : await linkThemes(prisma, { watchItemId: item?.id, runId: flag("run"), map: !has("no-map") });
      console.log(
        `${item?.name ?? "All items"}: ${r.linked} mentions linked, ${r.mapped} labels mapped into themes, ${r.created} new themes, ${r.unlinked} left unlinked, mapper $${r.costUsd.toFixed(4)}.`
      );
    }
  }
  const merge = flag("merge");
  if (merge) {
    const [from, into] = merge.split(":");
    const [item] = await itemIds();
    if (!from || !into || !item || !flag("item")) throw new Error("--merge=<fromSlug>:<intoSlug> needs --item=");
    const r = await mergeThemes(prisma, item.id, from, into);
    console.log(`Merged ${from} into ${into}: ${r.mentions} mentions, ${r.aliases} aliases moved.`);
  }
  if (has("groups") || has("list-new")) {
    const limit = Number(flag("limit") ?? 20);
    for (const item of await itemIds()) {
      const themes = await prisma.canonicalTheme.findMany({
        where: { watchItemId: item.id, ...(has("list-new") ? { status: "new" } : {}) },
        select: { slug: true, name: true, status: true, mentions: { select: { normalized: true } } },
      });
      const rows = themes
        .map((t) => ({ ...t, wordings: [...new Set(t.mentions.map((m) => m.normalized))] }))
        .filter((t) => t.mentions.length)
        .sort((a, b) => (has("list-new") ? b.mentions.length - a.mentions.length : b.wordings.length - a.wordings.length));
      console.log(`\n${item.name}: ${rows.length} ${has("list-new") ? "new themes with mentions" : "themes with mentions"}`);
      for (const t of rows.slice(0, limit)) {
        console.log(`  ${t.slug} (${t.status}) "${t.name}": ${t.mentions.length} mentions, ${t.wordings.length} wordings`);
        console.log(`    ${t.wordings.slice(0, 12).join("; ")}${t.wordings.length > 12 ? "; …" : ""}`);
      }
    }
  }
  const restat = flag("restat");
  if (restat) {
    for (const runId of restat.split(",")) {
      const run = await prisma.run.findUniqueOrThrow({ where: { id: runId }, select: { stats: true } });
      const old = run.stats as SnapshotStats | null;
      const stats = await snapshotStats(prisma, runId, old?.repeats ?? 3);
      if (old?.stoppedAtCapUsd != null) stats.stoppedAtCapUsd = old.stoppedAtCapUsd;
      if (old?.comparison) stats.comparison = old.comparison;
      await prisma.run.update({ where: { id: runId }, data: { stats: JSON.parse(JSON.stringify(stats)) } });
      const t = stats.agreement.totals.theme;
      console.log(`${runId}: themes held ${t.held}, noisy ${t.noisy}; theme band ${((stats.noise.all?.theme.band ?? 0) * 100).toFixed(1)} pts.`);
    }
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
