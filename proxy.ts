import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * This app has no Server Actions. Scanners still POST to random paths with a
 * `Next-Action` header, probing for vulnerable actions, and every one makes
 * Next.js log a "Failed to find Server Action" error that buries real errors.
 * Answer those with a plain 404 before Next.js tries to resolve the action.
 *
 * If a Server Action is ever added, remove this file (or narrow the matcher).
 */
export function proxy(request: NextRequest) {
  if (request.method === "POST") {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    {
      source: "/:path*",
      has: [{ type: "header", key: "next-action" }],
    },
  ],
};
