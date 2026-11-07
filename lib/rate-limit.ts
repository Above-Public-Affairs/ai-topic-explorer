import { prisma } from "@/lib/db";
import { hashIp } from "@/lib/guards/client-ip";

export interface RateLimitRule {
  /** Separates counters for different endpoints. */
  bucket: string;
  max: number;
  windowMs: number;
}

export const ANALYZE_LIMIT: RateLimitRule = {
  bucket: "analyze",
  max: 10,
  windowMs: 60 * 60 * 1000,
};

export const BUG_REPORT_LIMIT: RateLimitRule = {
  bucket: "bug-report",
  max: 5,
  windowMs: 60 * 60 * 1000,
};

/** Counters older than this are deleted now and then. */
const RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_PROBABILITY = 0.02;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
}

/**
 * Count one request against `rule` for this IP. Counts live in Postgres
 * (fixed windows), so they survive deploys and are shared across replicas.
 * The upsert is a single atomic statement, so concurrent requests can't
 * both read the same count.
 *
 * Throws if the database is unreachable; callers decide whether to fail open
 * or closed.
 */
export async function checkRateLimit(
  ip: string,
  rule: RateLimitRule
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / rule.windowMs) * rule.windowMs);
  const key = hashIp(ip);

  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitCounter" ("bucket", "key", "windowStart", "count")
    VALUES (${rule.bucket}, ${key}, ${windowStart}, 1)
    ON CONFLICT ("bucket", "key", "windowStart")
    DO UPDATE SET "count" = "RateLimitCounter"."count" + 1
    RETURNING "count"
  `;
  const count = Number(rows[0]?.count ?? 1);

  if (Math.random() < CLEANUP_PROBABILITY) {
    prisma.rateLimitCounter
      .deleteMany({ where: { windowStart: { lt: new Date(now - RETENTION_MS) } } })
      .catch((e) => console.warn("[Rate limit] Cleanup failed:", e));
  }

  if (count > rule.max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: windowStart.getTime() + rule.windowMs - now,
    };
  }
  return { allowed: true, remaining: rule.max - count };
}
