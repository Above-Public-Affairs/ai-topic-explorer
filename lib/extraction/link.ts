/**
 * Write entity merging (canonical.ts) to the database: link each Entity row
 * to its CanonicalEntity, creating, extending or merging canonical entities.
 *
 * Runs in one transaction per batch under a Postgres advisory lock, so
 * concurrent extractions (the pipeline extracts four at once, and the public
 * site may run alongside) never create two entities for one name.
 */
import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";
import { EntityResolver, mentionKeys, type AliasKind, type CanonicalState, type EntityGroup } from "./canonical";

/** pg_advisory_xact_lock key for entity linking ("2.7"). */
const LOCK_KEY = 27_002_007;

export interface LinkResult {
  /** Entity rows linked to a canonical entity. */
  linked: number;
  /** Canonical entities created. */
  created: number;
  /** Canonical entities folded into another. */
  merged: number;
  /** Rows with nothing to match on (left unlinked). */
  skipped: number;
}

type Tx = Prisma.TransactionClient;

/**
 * Link entities that have no canonical entity yet. `extractionIds` limits it
 * to those extractions (the store does this after each extraction); without
 * it, every unlinked entity is linked, oldest extraction first, in batches.
 */
export async function linkEntities(
  db: PrismaClient,
  options: { extractionIds?: string[]; batchSize?: number } = {}
): Promise<LinkResult> {
  const total: LinkResult = { linked: 0, created: 0, merged: 0, skipped: 0 };
  const skippedIds: string[] = [];
  for (;;) {
    const res = await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
        const rows = await tx.entity.findMany({
          where: {
            canonicalEntityId: null,
            ...(options.extractionIds ? { extractionId: { in: options.extractionIds } } : {}),
            ...(skippedIds.length ? { id: { notIn: skippedIds } } : {}),
          },
          select: { id: true, name: true, type: true, canonicalName: true },
          orderBy: [{ extraction: { createdAt: "asc" } }, { id: "asc" }],
          take: options.batchSize ?? 1000,
        });
        if (!rows.length) return null;
        return linkBatch(tx, rows);
      },
      { maxWait: 30_000, timeout: 180_000 }
    );
    if (!res) break;
    total.linked += res.linked;
    total.created += res.created;
    total.merged += res.merged;
    total.skipped += res.skippedIds.length;
    skippedIds.push(...res.skippedIds);
  }
  return total;
}

async function linkBatch(
  tx: Tx,
  rows: { id: string; name: string; type: string; canonicalName: string | null }[]
): Promise<Omit<LinkResult, "skipped"> & { skippedIds: string[] }> {
  // Load only the canonical entities that share a key with these mentions.
  const keys = new Set<string>();
  for (const r of rows) {
    const k = mentionKeys(r);
    for (const p of k.primary) keys.add(p.key);
    for (const d of k.derived) keys.add(d);
  }
  const hits = keys.size
    ? await tx.entityAlias.findMany({ where: { key: { in: [...keys] } }, select: { canonicalEntityId: true } })
    : [];
  const ids = [...new Set(hits.map((h) => h.canonicalEntityId))];
  const existing = ids.length
    ? await tx.canonicalEntity.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, group: true, aliases: { select: { key: true, kind: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    : [];

  const resolver = new EntityResolver(
    existing.map(
      (c): CanonicalState => ({
        id: c.id,
        name: c.name,
        group: c.group as EntityGroup,
        aliases: c.aliases.map((a) => ({ key: a.key, kind: a.kind as AliasKind })),
      })
    )
  );
  const assigned = rows.map((r) => ({ id: r.id, canonical: resolver.resolve(r) }));
  const changes = resolver.changes();

  if (changes.created.length) {
    await tx.canonicalEntity.createMany({
      data: changes.created.map((c) => ({ id: c.id, name: c.name, group: c.group })),
    });
  }
  for (const c of changes.updated) {
    await tx.canonicalEntity.update({ where: { id: c.id }, data: { name: c.name } });
  }
  const aliasRows = [...changes.created, ...changes.updated].flatMap((c) =>
    c.aliases.map((a) => ({ canonicalEntityId: c.id, key: a.key, kind: a.kind }))
  );
  if (aliasRows.length) await tx.entityAlias.createMany({ data: aliasRows, skipDuplicates: true });

  for (const m of changes.merged) {
    await tx.entity.updateMany({ where: { canonicalEntityId: m.from }, data: { canonicalEntityId: m.into } });
    await tx.canonicalEntity.delete({ where: { id: m.from } });
  }

  const byCanonical = new Map<string, string[]>();
  const skippedIds: string[] = [];
  for (const a of assigned) {
    if (!a.canonical) {
      skippedIds.push(a.id);
      continue;
    }
    const final = resolver.finalId(a.canonical);
    if (!byCanonical.has(final)) byCanonical.set(final, []);
    byCanonical.get(final)!.push(a.id);
  }
  for (const [canonicalEntityId, entityIds] of byCanonical) {
    await tx.entity.updateMany({ where: { id: { in: entityIds } }, data: { canonicalEntityId } });
  }
  return {
    linked: rows.length - skippedIds.length,
    created: changes.created.length,
    merged: changes.merged.length,
    skippedIds,
  };
}

/**
 * Re-run merging over every stored entity: drop all canonical entities and
 * aliases and link everything again from scratch, oldest first, with the
 * current rules. Needed after the rules change. Mentions (Entity rows) are
 * untouched apart from their link. Not one transaction: if it stops partway,
 * running it again finishes the job.
 */
export async function relinkAllEntities(db: PrismaClient, options: { batchSize?: number } = {}): Promise<LinkResult> {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
    await tx.entity.updateMany({ where: { canonicalEntityId: { not: null } }, data: { canonicalEntityId: null } });
    await tx.canonicalEntity.deleteMany({});
  });
  return linkEntities(db, options);
}
