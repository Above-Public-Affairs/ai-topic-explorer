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

/**
 * What one visitor's rate limit is counted against. An IPv6 visitor usually
 * holds a whole /64 and can rotate addresses inside it per request, so IPv6
 * addresses count by their /64 (task 6.6, security review M1). IPv4, and IPv4
 * written as IPv6 (::ffff:1.2.3.4), count by the address.
 */
export function rateLimitSubject(ip: string): string {
  const bare = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (!bare.includes(":")) return bare;
  const mapped = bare.match(/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? bare.match(/^::(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const [head, tail] = bare.split("::");
  const parts = (s: string | undefined) => (s ? s.split(":").filter(Boolean) : []);
  const front = parts(head);
  const back = tail === undefined ? [] : parts(tail);
  if (tail === undefined && front.length !== 8) return bare; // not an address we understand; count it as-is
  const groups = [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return bare;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/** Rate-limit keys store a hash, not the raw address. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`ate:${ip}`).digest("hex").slice(0, 32);
}
