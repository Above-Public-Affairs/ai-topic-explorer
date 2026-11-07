import { createHash } from "node:crypto";

/**
 * The visitor's IP as Railway's edge saw it.
 *
 * Railway's edge sets `X-Real-IP` to the client's remote address
 * (docs.railway.com/networking/public-networking/specs-and-limits). It also
 * appends that address to `X-Forwarded-For`, so the right-most hop is the one
 * Railway added. The left-most hop is whatever the client sent, which is why
 * it can't be trusted for rate limiting: anyone can rotate it per request.
 */
export function getClientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const hops = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((h) => h.trim())
    .filter(Boolean);
  if (hops && hops.length > 0) return hops[hops.length - 1];

  return "unknown";
}

/** Rate-limit keys store a hash, not the raw address. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`ate:${ip}`).digest("hex").slice(0, 32);
}
