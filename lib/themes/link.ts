/**
 * Theme merging (task 4.8): link each Theme mention of a watch item's answer
 * to one CanonicalTheme, so the same idea worded differently is one finding.
 * Each mention keeps its own label; Theme.canonicalThemeId points at the idea.
 *
 * Three steps, cheapest first:
 * 1. **Alias table.** The label's themeKey (key.ts) under its sub-topic is
 *    looked up in ThemeAlias: the vocabulary's own aliases (vocab.ts), plus
 *    every earlier mapper choice. No AI call. The extraction store runs only
 *    this step, right after each extraction.
 * 2. **Label mapper** (mapper.ts), for labels still unknown: one batched call
 *    per snapshot, never per answer. Its choice is stored as an alias.
 * 3. **New theme.** A label the mapper says fits nothing gets a CanonicalTheme
 *    of its own (status "new"), so its later mentions join it; it's offered
 *    to the mapper as an option from then on, and listed for review.
 *
 * Alias keys are "<scope>|<themeKey>". The scope is the label's sub-topic
 * name ("-" for none). A sub-topic entry's aliases are stored under that
 * sub-topic and "-"; an overall entry's only under "-". So a label tagged
 * with a sub-topic is matched only by that sub-topic's aliases, and anything
 * else goes to the mapper with the sub-topic as context: "neighbor impacts"
 * under noise is a noise effect, not the overall community-impacts theme.
 */
import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";
import { themeKey } from "./key";
import { mapLabels, NEW_THEME, type MapperClient, type MapperTheme } from "./mapper";
import { THEME_VOCAB, type VocabTheme } from "./vocab";

/** pg_advisory_xact_lock key for theme linking ("4.8"). */
const LOCK_KEY = 48_004_008;
const NONE = "-";

type Tx = Prisma.TransactionClient;

export interface ThemeLinkResult {
  /** Mentions linked to a theme. */
  linked: number;
  /** Distinct labels the mapper placed in an existing theme. */
  mapped: number;
  /** New themes coined. */
  created: number;
  /** Mentions left unlinked (unknown labels when mapping is off, or a label with no letters). */
  unlinked: number;
  /** Mapper spend. */
  costUsd: number;
}

/** Keys a label is looked up by. */
export function lookupKeys(label: string, subTopic: string | null): string[] {
  const k = themeKey(label);
  if (!k) return [];
  return [`${subTopic ?? NONE}|${k}`];
}

/** The alias keys a vocabulary entry is stored under: its aliases, name and slug. */
export function vocabAliasKeys(entry: VocabTheme): string[] {
  const keys = new Set<string>();
  const scopes = entry.subTopic ? [entry.subTopic, NONE] : [NONE];
  for (const text of [entry.name, entry.slug.replace(/-/g, " "), ...(entry.aliases ?? [])]) {
    const k = themeKey(text);
    if (k) for (const s of scopes) keys.add(`${s}|${k}`);
  }
  return [...keys];
}

export function newThemeSlug(scope: string, key: string): string {
  return `new-${scope === NONE ? "" : `${scope}-`}${key}`.replace(/\s+/g, "-");
}

/**
 * Write a watch item's vocabulary (vocab.ts) to CanonicalTheme and its
 * aliases. Safe to repeat: updates names and descriptions, adds new entries
 * and aliases, and never moves an alias that already points somewhere.
 */
export async function seedThemeVocab(db: PrismaClient | Tx, watchItemId: string): Promise<{ themes: number; aliases: number }> {
  const item = await db.watchItem.findUniqueOrThrow({ where: { id: watchItemId }, select: { name: true, subTopics: { select: { id: true, name: true } } } });
  const vocab = THEME_VOCAB[item.name] ?? [];
  const subTopicId = new Map(item.subTopics.map((s) => [s.name, s.id]));
  let aliases = 0;
  for (const entry of vocab) {
    const data = {
      name: entry.name,
      description: entry.description,
      subTopicId: entry.subTopic ? (subTopicId.get(entry.subTopic) ?? null) : null,
      status: "vocab",
    };
    const theme = await db.canonicalTheme.upsert({
      where: { watchItemId_slug: { watchItemId, slug: entry.slug } },
      create: { watchItemId, slug: entry.slug, ...data },
      update: data,
      select: { id: true },
    });
    const res = await db.themeAlias.createMany({
      data: vocabAliasKeys(entry).map((key) => ({ watchItemId, canonicalThemeId: theme.id, key, source: "vocab" })),
      skipDuplicates: true,
    });
    aliases += res.count;
  }
  return { themes: vocab.length, aliases };
}

/** Seed only when the stored vocabulary is behind the file (cheap enough to call per extraction). */
async function ensureVocab(db: PrismaClient, watchItemId: string, itemName: string) {
  const want = THEME_VOCAB[itemName]?.length ?? 0;
  if (!want) return;
  const have = await db.canonicalTheme.count({ where: { watchItemId, status: "vocab" } });
  if (have < want) await seedThemeVocab(db, watchItemId);
}

interface Mention {
  id: string;
  label: string;
  subTopic: string | null;
}

/**
 * Link theme mentions that have no canonical theme yet. Scope with `runId`
 * or `extractionIds`; with neither, every unlinked mention of every watch
 * item. `map: false` runs only the alias step (no AI call). Public-site runs
 * (no watch item) are left alone.
 */
export async function linkThemes(
  db: PrismaClient,
  options: { runId?: string; extractionIds?: string[]; watchItemId?: string; map?: boolean; client?: MapperClient; signal?: AbortSignal } = {}
): Promise<ThemeLinkResult> {
  const total: ThemeLinkResult = { linked: 0, mapped: 0, created: 0, unlinked: 0, costUsd: 0 };
  const rows = await db.theme.findMany({
    where: {
      canonicalThemeId: null,
      ...(options.extractionIds ? { extractionId: { in: options.extractionIds } } : {}),
      extraction: {
        answer: {
          ...(options.runId ? { runId: options.runId } : {}),
          run: { watchItemId: options.watchItemId ? options.watchItemId : { not: null } },
        },
      },
    },
    select: {
      id: true,
      label: true,
      subTopic: { select: { name: true } },
      extraction: { select: { answer: { select: { run: { select: { watchItemId: true, topic: true } } } } } },
    },
  });
  const byItem = new Map<string, { topic: string; mentions: Mention[] }>();
  for (const r of rows) {
    const run = r.extraction.answer.run;
    if (!run.watchItemId) continue;
    if (!byItem.has(run.watchItemId)) byItem.set(run.watchItemId, { topic: run.topic, mentions: [] });
    byItem.get(run.watchItemId)!.mentions.push({ id: r.id, label: r.label, subTopic: r.subTopic?.name ?? null });
  }
  for (const [watchItemId, { topic, mentions }] of byItem) {
    const res = await linkItem(db, watchItemId, topic, mentions, options);
    total.linked += res.linked;
    total.mapped += res.mapped;
    total.created += res.created;
    total.unlinked += res.unlinked;
    total.costUsd += res.costUsd;
  }
  total.costUsd = Math.round(total.costUsd * 1e8) / 1e8;
  return total;
}

async function linkItem(
  db: PrismaClient,
  watchItemId: string,
  topic: string,
  mentions: Mention[],
  options: { map?: boolean; client?: MapperClient; signal?: AbortSignal }
): Promise<ThemeLinkResult> {
  const item = await db.watchItem.findUniqueOrThrow({ where: { id: watchItemId }, select: { name: true, subTopics: { select: { id: true, name: true } } } });
  await ensureVocab(db, watchItemId, item.name);

  const aliasMap = async () =>
    new Map((await db.themeAlias.findMany({ where: { watchItemId }, select: { key: true, canonicalThemeId: true } })).map((a) => [a.key, a.canonicalThemeId]));
  let aliases = await aliasMap();
  const resolve = (m: Mention) => lookupKeys(m.label, m.subTopic).map((k) => aliases.get(k)).find(Boolean) ?? null;

  let mapped = 0;
  let created = 0;
  let costUsd = 0;
  // Labels no alias knows, one entry per (sub-topic, key).
  const unknown = new Map<string, { label: string; subTopic: string | null; scope: string; key: string }>();
  for (const m of mentions) {
    if (resolve(m)) continue;
    const key = themeKey(m.label);
    if (!key) continue;
    const scope = m.subTopic ?? NONE;
    const id = `${scope}|${key}`;
    if (!unknown.has(id)) unknown.set(id, { label: m.label, subTopic: m.subTopic, scope, key });
  }

  if (options.map !== false && unknown.size) {
    const themes = await db.canonicalTheme.findMany({
      where: { watchItemId },
      select: { id: true, slug: true, name: true, description: true, status: true, subTopic: { select: { name: true } } },
      orderBy: [{ status: "desc" }, { createdAt: "asc" }],
    });
    const options_: MapperTheme[] = themes.map((t) => ({ slug: t.slug, name: t.name, subTopic: t.subTopic?.name ?? null, description: t.description }));
    const list = [...unknown.values()];
    const out = await mapLabels(topic, options_, list, { client: options.client, signal: options.signal });
    costUsd = out.costUsd;
    const bySlug = new Map(themes.map((t) => [t.slug, t.id]));
    const subTopicId = new Map(item.subTopics.map((s) => [s.name, s.id]));

    await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
        for (let i = 0; i < list.length; i++) {
          const u = list[i];
          const aliasKey = `${u.scope}|${u.key}`;
          let canonicalThemeId: string;
          let source: string;
          if (out.choices[i] !== NEW_THEME && bySlug.has(out.choices[i])) {
            canonicalThemeId = bySlug.get(out.choices[i])!;
            source = "mapper";
            mapped++;
          } else {
            const slug = newThemeSlug(u.scope, u.key);
            const where = { watchItemId_slug: { watchItemId, slug } };
            let theme = await tx.canonicalTheme.findUnique({ where, select: { id: true } });
            if (!theme) {
              theme = await tx.canonicalTheme.create({
                data: { watchItemId, slug, name: u.label, status: "new", subTopicId: u.subTopic ? (subTopicId.get(u.subTopic) ?? null) : null },
                select: { id: true },
              });
              created++;
            }
            canonicalThemeId = theme.id;
            source = "new";
          }
          // A concurrent run may have stored this key first; the stored one wins.
          await tx.themeAlias.createMany({ data: [{ watchItemId, canonicalThemeId, key: aliasKey, source }], skipDuplicates: true });
        }
      },
      { maxWait: 30_000, timeout: 120_000 }
    );
    aliases = await aliasMap();
  }

  const byTheme = new Map<string, string[]>();
  let unlinked = 0;
  for (const m of mentions) {
    const id = resolve(m);
    if (!id) {
      unlinked++;
      continue;
    }
    if (!byTheme.has(id)) byTheme.set(id, []);
    byTheme.get(id)!.push(m.id);
  }
  for (const [canonicalThemeId, ids] of byTheme) {
    await db.theme.updateMany({ where: { id: { in: ids }, canonicalThemeId: null }, data: { canonicalThemeId } });
  }
  return { linked: mentions.length - unlinked, mapped, created, unlinked, costUsd };
}

/**
 * Re-link from scratch after the vocabulary or rules change: clear every
 * mention's link for the item (or all items), reseed the vocabulary, and
 * link again. `forgetMapped` also drops the mapper's stored choices and the
 * new themes, so every label is mapped afresh (costs a mapper pass).
 */
export async function relinkThemes(
  db: PrismaClient,
  options: { watchItemId?: string; forgetMapped?: boolean; client?: MapperClient } = {}
): Promise<ThemeLinkResult> {
  const items = await db.watchItem.findMany({ where: options.watchItemId ? { id: options.watchItemId } : {}, select: { id: true } });
  for (const { id } of items) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
      await tx.theme.updateMany({ where: { canonical: { watchItemId: id } }, data: { canonicalThemeId: null } });
      if (options.forgetMapped) {
        await tx.themeAlias.deleteMany({ where: { watchItemId: id, source: { in: ["mapper", "new"] } } });
        await tx.canonicalTheme.deleteMany({ where: { watchItemId: id, status: "new" } });
      }
    });
    await seedThemeVocab(db, id);
  }
  return linkThemes(db, { watchItemId: options.watchItemId, client: options.client });
}

/**
 * Fold one theme into another (a reviewed "new" theme into the vocabulary,
 * or two new themes together): its mentions and aliases move, it is deleted.
 */
export async function mergeThemes(db: PrismaClient, watchItemId: string, fromSlug: string, intoSlug: string): Promise<{ mentions: number; aliases: number }> {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
    const from = await tx.canonicalTheme.findUniqueOrThrow({ where: { watchItemId_slug: { watchItemId, slug: fromSlug } }, select: { id: true } });
    const into = await tx.canonicalTheme.findUniqueOrThrow({ where: { watchItemId_slug: { watchItemId, slug: intoSlug } }, select: { id: true } });
    if (from.id === into.id) throw new Error("A theme can't be merged into itself.");
    const mentions = await tx.theme.updateMany({ where: { canonicalThemeId: from.id }, data: { canonicalThemeId: into.id } });
    const aliases = await tx.themeAlias.updateMany({ where: { canonicalThemeId: from.id }, data: { canonicalThemeId: into.id, source: "manual" } });
    await tx.canonicalTheme.delete({ where: { id: from.id } });
    return { mentions: mentions.count, aliases: aliases.count };
  });
}
