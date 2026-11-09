/**
 * Watch items' question sets (task 4.2, lib/questions).
 *
 *   npm run questions -- --list
 *   railway run -- env DATABASE_URL=<local> npm run questions -- --draft-anchor [--item="Data centers in Texas"]
 *   npm run questions -- --draft-anchor --from=scripts/anchor-sets/<file>.json   (store a reviewed file as drafts, local only)
 *   npm run questions -- --lock-anchor --item="…"          (local only)
 *   railway run -- env DATABASE_URL=<local> npm run questions -- --fresh [--item="…"]   (local only)
 *   npm run questions -- --export=scripts/anchor-sets/2026-11-09.json
 *   npm run questions -- --migration=scripts/anchor-sets/2026-11-09.json --reviewed=2026-11-10
 *   npm run questions -- --retire=<questionId> --reason="…"
 *
 * Without --item, draft/lock/fresh run for every active watch item.
 *
 * Production anchor sets: Josh reads the exported file; once he approves it,
 * --migration prints an additive migration that inserts those exact
 * questions locked. Commit it under prisma/migrations and push; the deploy's
 * pre-deploy step applies it. So this script writes to local databases only,
 * except --retire, which is safe anywhere.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { prisma } from "@/lib/db";
import {
  ANCHOR_SET_NUMBER,
  anchorMigrationSql,
  draftAnchorSet,
  lockAnchorSet,
  questionLabel,
  questionsForSnapshot,
  retireQuestion,
  type ReviewedFile,
  type Style,
} from "@/lib/questions";

const args = process.argv.slice(2);
const has = (name: string) => args.includes(`--${name}`) || args.some((a) => a.startsWith(`--${name}=`));
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const dbUrl = process.env.DATABASE_URL ?? "";
const isLocal = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(dbUrl);
function localOnly(what: string) {
  if (!isLocal) {
    console.error(`${what} writes to the database: DATABASE_URL must point at a local one. Production anchor sets go in by migration (--migration).`);
    process.exit(1);
  }
}

async function items() {
  const name = flag("item");
  const rows = await prisma.watchItem.findMany({
    where: { active: true, ...(name ? { name } : {}) },
    orderBy: { createdAt: "asc" },
    include: { subTopics: { where: { retiredAt: null } } },
  });
  if (name && rows.length === 0) throw new Error(`No active watch item named "${name}"`);
  return rows;
}

function printSet(title: string, number: number, questions: { position: number; text: string; concern: string | null; lean?: string | null; why?: string | null; subTopicId: string | null; retiredAt?: Date | null }[], subTopics: Map<string, string>, styles: string[] = []) {
  console.log(`\n${title}`);
  for (const q of questions) {
    const sub = q.subTopicId ? subTopics.get(q.subTopicId) : null;
    const tags = [sub ? `sub-topic: ${sub}` : "overall", styles[q.position - 1] ?? null, q.lean ? `lean: ${q.lean}` : null, q.concern ? `concern: ${q.concern}` : null, q.retiredAt ? "RETIRED" : null].filter(Boolean).join("; ");
    console.log(`  ${questionLabel(number, q.position)}  ${q.text}\n        (${tags})${q.why ? `\n        why: ${q.why}` : ""}`);
  }
}

async function list() {
  for (const item of await items()) {
    const subTopics = new Map(item.subTopics.map((s) => [s.id, s.name]));
    console.log(`\n=== ${item.name} (asked as a user in ${item.askCity}, ${item.askRegion}) — sub-topics: ${item.subTopics.map((s) => s.name).join(", ") || "none"}`);
    const sets = await prisma.questionSet.findMany({
      where: { watchItemId: item.id },
      orderBy: { number: "asc" },
      include: { questions: { orderBy: { position: "asc" } } },
    });
    if (sets.length === 0) console.log("  (no question sets yet)");
    for (const s of sets) {
      const state = s.lockedAt ? `locked ${s.lockedAt.toISOString().slice(0, 10)}` : "DRAFT, not locked";
      const cost = s.costUsd != null ? `, $${s.costUsd.toFixed(4)}` : "";
      printSet(`Set ${s.number} — ${s.kind}, ${state}${cost}`, s.number, s.questions, subTopics);
    }
  }
}

async function main() {
  if (has("list")) return list();

  if (has("draft-anchor")) {
    localOnly("--draft-anchor");
    const from = flag("from");
    const reviewed = from ? (JSON.parse(readFileSync(from, "utf8")) as ReviewedFile) : null;
    let total = 0;
    for (const item of await items()) {
      const fromFile = reviewed?.items.find((i) => i.watchItem === item.name);
      if (reviewed && !fromFile) continue;
      const set = await draftAnchorSet(prisma, item.id, fromFile ? { questions: fromFile.questions.map((q) => ({ ...q, style: q.style ?? "plain" })) } : {});
      total += set.costUsd ?? 0;
      const g = set.generation as { rejected?: { text: string; issues: string[] }[]; missing?: string[]; shape?: string[]; styles?: string[] } | null;
      const styles = g?.styles ?? fromFile?.questions.map((q) => q.style ?? "") ?? [];
      printSet(`${item.name}: draft anchor set ($${(set.costUsd ?? 0).toFixed(4)})`, set.number, set.questions, new Map(item.subTopics.map((s) => [s.id, s.name])), styles);
      for (const r of g?.rejected ?? []) console.log(`  rejected: ${r.text} — ${r.issues.join("; ")}`);
      if (g?.missing?.length) console.log(`  STILL MISSING: ${g.missing.join(", ")}`);
      if (g?.shape?.length) console.log(`  SHAPE: ${g.shape.join("; ")}`);
    }
    console.log(`\nTotal $${total.toFixed(4)}`);
    return;
  }

  if (has("lock-anchor")) {
    localOnly("--lock-anchor");
    for (const item of await items()) {
      await lockAnchorSet(prisma, item.id);
      console.log(`${item.name}: anchor set locked`);
    }
    return;
  }

  if (has("fresh")) {
    localOnly("--fresh");
    let total = 0;
    for (const item of await items()) {
      const run = await prisma.run.create({
        data: {
          kind: "manual",
          status: "complete",
          finishedAt: new Date(),
          watchItemId: item.id,
          topic: item.name,
          askCity: item.askCity,
          askRegion: item.askRegion,
          askCountry: item.askCountry,
          askTimezone: item.askTimezone,
          note: "Fresh question set only; nothing asked (task 4.2 proof)",
        },
      });
      const result = await questionsForSnapshot(prisma, { watchItemId: item.id, runId: run.id });
      total += result.costUsd;
      const set = await prisma.questionSet.findUniqueOrThrow({ where: { runId: run.id }, include: { questions: { orderBy: { position: "asc" } } } });
      const g = set.generation as { searches?: number; searchQueries?: string[]; rejected?: { text: string; issues: string[] }[]; shape?: string[]; styles?: string[] } | null;
      console.log(`\n=== ${item.name}: snapshot ${run.id} asks ${result.locked.length} locked + ${result.fresh.length} fresh`);
      if (result.promoted.length) console.log(`  promoted: ${result.promoted.map((p) => p.text).join(" | ")}`);
      printSet(`Fresh set ${set.number} ($${result.costUsd.toFixed(4)}, ${g?.searches ?? 0} searches: ${(g?.searchQueries ?? []).join(" | ")})`, set.number, set.questions, new Map(item.subTopics.map((s) => [s.id, s.name])), g?.styles);
      for (const r of g?.rejected ?? []) console.log(`  rejected: ${r.text} — ${r.issues.join("; ")}`);
      if (g?.shape?.length) console.log(`  SHAPE: ${g.shape.join("; ")}`);
    }
    console.log(`\nTotal $${total.toFixed(4)}`);
    return;
  }

  const exportTo = flag("export");
  if (exportTo) {
    const file: ReviewedFile = { writtenAt: "", model: null, promptVersion: null, items: [] };
    for (const item of await items()) {
      const set = await prisma.questionSet.findUnique({
        where: { watchItemId_number: { watchItemId: item.id, number: ANCHOR_SET_NUMBER } },
        include: { questions: { where: { retiredAt: null }, orderBy: { position: "asc" }, include: { subTopic: true } } },
      });
      if (!set) throw new Error(`${item.name} has no anchor set to export`);
      file.writtenAt = set.createdAt.toISOString();
      file.model = set.model;
      file.promptVersion = set.promptVersion;
      file.items.push({
        watchItem: item.name,
        questions: set.questions.map((q) => ({
          label: questionLabel(set.number, q.position),
          text: q.text,
          subTopic: q.subTopic?.name ?? null,
          concern: q.concern ?? "",
          lean: q.lean ?? "neutral",
          style: ((set.generation as { styles?: Style[] } | null)?.styles ?? [])[q.position - 1],
        })),
      });
    }
    mkdirSync(dirname(exportTo), { recursive: true });
    writeFileSync(exportTo, JSON.stringify(file, null, 2) + "\n");
    console.log(`Wrote ${exportTo}`);
    return;
  }

  const migrationFrom = flag("migration");
  if (migrationFrom) {
    const reviewed = flag("reviewed");
    if (!reviewed) throw new Error("--reviewed=YYYY-MM-DD (the day Josh approved the file) is required");
    process.stdout.write(anchorMigrationSql(JSON.parse(readFileSync(migrationFrom, "utf8")) as ReviewedFile, reviewed));
    return;
  }

  const retire = flag("retire");
  if (retire) {
    const reason = flag("reason");
    if (!reason) throw new Error("--reason is required");
    const q = await retireQuestion(prisma, retire, reason);
    console.log(`Retired ${q.id} on ${q.retiredAt?.toISOString()}`);
    return;
  }

  console.error("Nothing to do: see the usage at the top of scripts/question-sets.ts");
  process.exit(1);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
