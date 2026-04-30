/**
 * Deprecation instrumentation for legacy /api/* routes.
 *
 * Goal: enable a data-driven decision about *when* to delete legacy
 * routes during the iOS-to-v1-only migration. While the migration is in
 * flight, we cannot remove legacy routes blindly — old iOS clients,
 * stale caches, and third-party callers may still rely on them.
 *
 * Plan: every legacy request emits a structured log line (captured by
 * Vercel) and the response carries RFC 8594 deprecation headers
 * (`Deprecation`, `Sunset`, `Link`). When residual traffic on a route
 * drops to zero (or all remaining users can be force-updated), the
 * route is safe to delete.
 *
 * Why a path predicate, not a per-route opt-in: legacy routes are
 * heterogeneous — many predate the v1 surface entirely. Wiring an
 * opt-in helper into ~30 route files would be invasive and error-
 * prone. The middleware sees every request URL once; one predicate
 * here covers all of them.
 *
 * Auth flows (`/api/auth/*`) are included because iOS hits
 * `/api/auth/mobile-*` and we want that traffic visible during the
 * cutover. NextAuth web flows under the same prefix will also log;
 * filter them out at query time by user-agent.
 */

/**
 * Target sunset date. RFC 8594 expects an HTTP-date (RFC 7231 §7.1.1.1).
 * The constant is fixed (not "now + 60 days") so the header doesn't
 * silently slide forward on every request — that defeats the purpose of
 * a Sunset header. Move this date forward only as a deliberate planning
 * decision, in a separate PR.
 *
 * Current target: 2026-08-01. Rationale: Phase 1 (build v1 parity) ~2
 * weeks, Phase 2 (iOS migration release) ~2 weeks, Phase 3 (residual
 * monitoring) ≥4 weeks → comfortable buffer with the sunset 3 months out
 * from when this lands.
 */
export const LEGACY_SUNSET_HTTP_DATE = 'Sat, 01 Aug 2026 00:00:00 GMT'

/** Path under which the v1 successor surface lives. */
const V1_PREFIX = '/api/v1/'

/**
 * Internal route prefixes that are NOT iOS-facing and should NOT be
 * counted in the deprecation telemetry. These are infrastructure
 * (cron, admin, MCP), webhooks (GitHub inbound), or routes that
 * intentionally have no v1 successor (SSE stream, health probe).
 */
const INTERNAL_PREFIXES = [
  '/api/cron/',
  '/api/admin/',
  '/api/mcp/',
  '/api/coding-workflow/',
  '/api/agent-workflow/',
  '/api/assistant-workflow/',
  '/api/github/webhooks',
  '/api/sse',
  '/api/health',
  '/api/debug-',
  '/api/openclaw/', // OAuth-only agent endpoints; v1 has /api/v1/openclaw/*
  '/api/redis-debug',
] as const

/**
 * True for legacy `/api/*` requests that participate in the iOS
 * migration. Excludes the v1 surface itself, internal infra routes, and
 * webhook receivers.
 *
 * Pure function — no side effects, safe to call from edge runtime.
 */
export function isLegacyApiPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/')) return false
  if (pathname.startsWith(V1_PREFIX)) return false
  for (const prefix of INTERNAL_PREFIXES) {
    if (pathname.startsWith(prefix)) return false
  }
  return true
}

/**
 * Structured payload logged for every legacy hit. Designed for Vercel
 * log queries: `{"deprecation":"legacy-api","route":"/api/tasks",...}`
 * is greppable and aggregatable via the Vercel API.
 *
 * Intentionally does NOT include the userId — the middleware runs in
 * the edge runtime and can't run Prisma to resolve the session. UA +
 * request-id are enough to bucket traffic; route-handler-level logs
 * already carry userId where it matters for individual-user follow-up.
 */
export interface LegacyApiHit {
  deprecation: 'legacy-api'
  route: string
  method: string
  userAgent: string | null
  /** Vercel-injected request id, if available. */
  requestId: string | null
  /** Vercel deployment id, lets us bucket by build. */
  deploymentId: string | null
  /** ISO timestamp. Redundant with the log line's own timestamp but lets
   *  query results be self-contained. */
  timestamp: string
}

/**
 * Build the structured payload for a legacy hit. Pulled into its own
 * function so the middleware stays a one-liner and the test can pin the
 * shape.
 */
export function buildLegacyApiHit(args: {
  pathname: string
  method: string
  headers: Headers
}): LegacyApiHit {
  return {
    deprecation: 'legacy-api',
    route: args.pathname,
    method: args.method,
    userAgent: args.headers.get('user-agent'),
    requestId: args.headers.get('x-vercel-id') ?? args.headers.get('x-request-id'),
    deploymentId: args.headers.get('x-vercel-deployment-id'),
    timestamp: new Date().toISOString(),
  }
}

/**
 * RFC 8594 deprecation headers. Returned as a plain record so the
 * middleware can spread them onto NextResponse.next() / .redirect().
 *
 * - `Deprecation: true` — RFC 8594, signals the resource is deprecated
 * - `Sunset: <http-date>` — RFC 8594, the date after which it may be removed
 * - `Link: <successor-url>; rel="successor-version"` — RFC 5988 link relation
 */
export function buildDeprecationHeaders(pathname: string): Record<string, string> {
  return {
    Deprecation: 'true',
    Sunset: LEGACY_SUNSET_HTTP_DATE,
    Link: `<${pathname.replace('/api/', '/api/v1/')}>; rel="successor-version"`,
  }
}
