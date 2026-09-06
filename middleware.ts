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
import { LEGACY_USAGE_BEACON_PATH, decideLegacyBeacon } from '@/lib/legacy-api-usage'
import { BRAND } from '@/lib/brand/config'
import { corsHeadersForOrigin } from '@/lib/cors'
import { buildContentSecurityPolicy, generateNonce } from '@/lib/csp'

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
function beaconLegacyHit(request: NextRequest, pathname: string, weight: number): Promise<unknown> {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return Promise.resolve()

  return fetch(new URL(LEGACY_USAGE_BEACON_PATH, request.nextUrl.origin), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
    body: JSON.stringify({
      route: pathname,
      method: request.method,
      // How many hits this beacon stands for; the recorder increments by it, so
      // sampling does not shrink the counts by a factor of ten.
      weight,
      ua: request.headers.get('user-agent') || '',
      xPlatform: request.headers.get('x-platform'),
      oauthBearer: (request.headers.get('authorization') || '').startsWith('Bearer astrid_'),
    }),
  }).catch(() => {})
}

export function middleware(request: NextRequest, event?: NextFetchEvent) {
  const host = request.headers.get("host") || ""
  const pathname = request.nextUrl.pathname
  const isApi = pathname.startsWith("/api")

  // CORS for the API. This lived in next.config.mjs as a STATIC header, which
  // is structurally incapable of the thing it needed to do: it sent
  // `Access-Control-Allow-Origin: https://astrid.cc` together with
  // `Allow-Credentials: true` on every deployment, so a partner's API granted
  // credentialed cross-origin access to somebody else's domain, and with no
  // `Vary: Origin` a shared cache could hand one origin's grant to another.
  // Here the request Origin exists, so the header is reflected only when it is
  // on this brand's allow-list and omitted otherwise (task 229c175c).
  const corsHeaders = isApi ? corsHeadersForOrigin(request.headers.get("origin")) : null

  // Preflight never reaches a route handler; answer it here.
  if (corsHeaders && request.method === "OPTIONS") {
    const preflight = new NextResponse(null, { status: 204 })
    for (const [k, v] of Object.entries(corsHeaders)) preflight.headers.set(k, v)
    return preflight
  }

  /** Attach the CORS headers, if this is an API request, to any response we build. */
  const withCors = (response: NextResponse) => {
    if (corsHeaders) {
      for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v)
    }
    return response
  }

  // Content Security Policy, built around a per-request nonce. It used to be a
  // static header in next.config.mjs carrying 'unsafe-inline' in script-src,
  // which defeats the point of having a CSP at all — that directive permits
  // exactly the injected script CSP exists to stop. A nonce cannot be static,
  // so the policy is assembled here (task eea00b1b).
  //
  // API responses are JSON and execute nothing, so they are left alone; a
  // pointless CSP on every API response is bytes on a hot path.
  const nonce = isApi ? null : generateNonce()
  const csp = nonce ? buildContentSecurityPolicy(nonce, process.env.NODE_ENV === 'production') : null

  /**
   * Next applies the nonce to its OWN bootstrap scripts by reading it back off
   * the request headers, so it has to be set on both sides — response only,
   * and every Next script is blocked by its own policy.
   */
  const withCsp = (response: NextResponse) => {
    if (csp) response.headers.set('Content-Security-Policy', csp)
    return response
  }

  // Next reads the nonce back off the REQUEST headers to stamp its own
  // bootstrap scripts, so it has to be forwarded, not just returned. Set on the
  // incoming headers so next-intl's own response inherits it too — it builds
  // its response itself and offers no hook for request headers.
  if (nonce && csp) {
    request.headers.set('x-nonce', nonce)
    request.headers.set('Content-Security-Policy', csp)
  }

  const nonceRequestInit = nonce ? { request: { headers: request.headers } } : undefined

  // Canonicalise the apex to www for THIS brand's domain. Hardcoding astrid.cc
  // sent a partner's apex traffic to somebody else's host.
  // EXCEPT for:
  // - .well-known paths (needed for iOS passkeys/AASA)
  // - /api routes (the iOS app uses the apex directly for API calls)
  // - /mcp (task a0e0808c): this redirect crosses hosts, and HTTP clients drop
  //   the Authorization header when they follow it. MCP clients pointed at
  //   https://<domain>/mcp therefore arrived unauthenticated and got a 401
  //   that looked like a credentials problem. /mcp is an API surface, not a
  //   page — it must not be canonicalised.
  if (
    host === BRAND.domain &&
    !pathname.startsWith("/.well-known") &&
    !isApi &&
    !pathname.startsWith("/mcp")
  ) {
    const url = request.nextUrl.clone()
    url.host = `www.${BRAND.domain}`
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
    // Sampled: this beacon is a second HTTP request into the app, which then
    // upserts, so sending one per legacy request roughly doubled invocations.
    // The first hit for each (route, method) on this instance is always sent —
    // see decideLegacyBeacon for why zero-hit routes must stay impossible.
    const beacon = decideLegacyBeacon(pathname, request.method)
    if (beacon.send) {
      event?.waitUntil?.(beaconLegacyHit(request, pathname, beacon.weight))
    }
    const response = NextResponse.next()
    for (const [k, v] of Object.entries(buildDeprecationHeaders(pathname))) {
      response.headers.set(k, v)
    }
    return withCors(response)
  }

  // Skip i18n for API routes, .well-known, MCP endpoints, and static PWA files.
  // Without this the request is rewritten to a /[locale]/... page that 404s,
  // which also shadows the next.config `/mcp -> /api/mcp` rewrite (task a0e0808c).
  if (shouldBypassIntlRouting(pathname)) {
    return withCsp(withCors(NextResponse.next(nonceRequestInit)))
  }

  // Apply i18n middleware for all other routes. It builds its own response, so
  // the nonce goes on by hand — next-intl has no hook for request headers.
  return withCsp(intlMiddleware(request))
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
     * - public folder files (icons, images, screenshots, vendor, etc.)
     * - sw.js (service worker)
     * - manifest.json (PWA manifest)
     * - Static asset extensions (.png, .jpg, .ico, .svg, .webp)
     * - .md (public docs such as ASTRID_WORKFLOW.md, which users download)
     */
    "/((?!_next/static|_next/image|favicon|apple-touch-icon|apple-icon|icons/|images/|screenshots/|sounds/|vendor/|sw\\.js|manifest\\.json|.*\\.png$|.*\\.ico$|.*\\.svg$|.*\\.jpg$|.*\\.webp$|.*\\.wav$|.*\\.md$).*)",
  ],
}
