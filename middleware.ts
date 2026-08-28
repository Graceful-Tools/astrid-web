import { NextResponse } from "next/server"
import type { NextFetchEvent, NextRequest } from "next/server"
import createMiddleware from 'next-intl/middleware'
import { routing } from '@/lib/i18n/routing'
import {
  isLegacyApiPath,
  buildLegacyApiHit,
  buildDeprecationHeaders,
} from '@/lib/api-deprecation'
import { shouldBypassIntlRouting } from '@/lib/middleware-bypass'
import { LEGACY_USAGE_BEACON_PATH } from '@/lib/legacy-api-usage'

// Create next-intl middleware
const intlMiddleware = createMiddleware(routing)

/**
 * Send a legacy hit to the durable census (task 641a7615, re-landed for
 * task 058d80ad).
 *
 * Fire-and-forget, handed to `waitUntil` so it runs after the response is on
 * its way — the request being measured never waits for it. Failures are
 * swallowed: telemetry for a migration must not be able to break traffic.
 *
 * EDGE-SAFETY IS THE WHOLE DESIGN. The first landing of this beacon imported
 * detectPlatform from analytics-events — one hop from Prisma — and the edge
 * bundle failed to instantiate: every request 500'd for ~12 minutes
 * (tests/middleware-edge-safety.test.ts). So this function does string ops on
 * headers ONLY and forwards the raw signals; the Node-side beacon route does
 * the platform classification with the one shared implementation. The
 * authorization header itself never leaves this function — only the boolean
 * prefix test detectPlatform needs.
 */
function beaconLegacyHit(request: NextRequest, pathname: string): Promise<unknown> {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return Promise.resolve()

  return fetch(new URL(LEGACY_USAGE_BEACON_PATH, request.nextUrl.origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
    body: JSON.stringify({
      route: pathname,
      method: request.method,
      ua: request.headers.get('user-agent') || '',
      xPlatform: request.headers.get('x-platform'),
      oauthBearer: (request.headers.get('authorization') || '').startsWith('Bearer astrid_'),
    }),
  }).catch(() => {})
}

export function middleware(request: NextRequest, event?: NextFetchEvent) {
  const host = request.headers.get("host") || ""
  const pathname = request.nextUrl.pathname

  // Redirect naked domain (astrid.cc) to www.astrid.cc
  // EXCEPT for:
  // - .well-known paths (needed for iOS passkeys/AASA)
  // - /api routes (iOS app uses astrid.cc directly for API calls)
  // - /mcp (task a0e0808c): this redirect crosses hosts, and HTTP clients drop
  //   the Authorization header when they follow it. MCP clients pointed at
  //   https://astrid.cc/mcp therefore arrived unauthenticated and got a 401
  //   that looked like a credentials problem. /mcp is an API surface, not a
  //   page — it must not be canonicalised.
  if (
    host === "astrid.cc" &&
    !pathname.startsWith("/.well-known") &&
    !pathname.startsWith("/api") &&
    !pathname.startsWith("/mcp")
  ) {
    const url = request.nextUrl.clone()
    url.host = "www.astrid.cc"
    // Use 308 to preserve HTTP method (301 converts POST to GET)
    return NextResponse.redirect(url, 308)
  }

  // Deprecation instrumentation for legacy /api/* during the
  // iOS-to-v1-only migration. Emits a structured log line (Vercel
  // captures it; query later to see which legacy routes still have
  // residual traffic) and attaches RFC 8594 deprecation headers to the
  // response. No behavior change — the request continues normally.
  if (isLegacyApiPath(pathname)) {
     
    console.log(JSON.stringify(buildLegacyApiHit({
      pathname,
      method: request.method,
      headers: request.headers,
    })))
    // The log line above is a live tail; Vercel keeps it for minutes. The
    // beacon is the durable half the >=4-week retirement window is actually
    // queryable from. Guarded: a missing NextFetchEvent (tests, or a runtime
    // that omits it) must not turn telemetry into a 500 on a real request.
    event?.waitUntil?.(beaconLegacyHit(request, pathname))
    const response = NextResponse.next()
    for (const [k, v] of Object.entries(buildDeprecationHeaders(pathname))) {
      response.headers.set(k, v)
    }
    return response
  }

  // Skip i18n for API routes, .well-known, MCP endpoints, and static PWA files.
  // Without this the request is rewritten to a /[locale]/... page that 404s,
  // which also shadows the next.config `/mcp -> /api/mcp` rewrite (task a0e0808c).
  if (shouldBypassIntlRouting(pathname)) {
    return NextResponse.next()
  }

  // Apply i18n middleware for all other routes
  return intlMiddleware(request)
}

export const config = {
  // Run on all paths except static files
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, favicon-*.png (favicon files)
     * - apple-touch-icon*.png, apple-icon*.png (Apple icons)
     * - public folder files (icons, images, screenshots, etc.)
     * - sw.js (service worker)
     * - manifest.json (PWA manifest)
     * - Static asset extensions (.png, .jpg, .ico, .svg, .webp)
     * - .md (public docs such as ASTRID_WORKFLOW.md, which users download)
     */
    "/((?!_next/static|_next/image|favicon|apple-touch-icon|apple-icon|icons/|images/|screenshots/|sounds/|sw\\.js|manifest\\.json|.*\\.png$|.*\\.ico$|.*\\.svg$|.*\\.jpg$|.*\\.webp$|.*\\.wav$|.*\\.md$).*)",
  ],
}
