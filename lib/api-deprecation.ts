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
 * Current target: 2026-11-01.
 *
 * History:
 * - 2026-08-01 (original): Phase 1 (build v1 parity) ~2 weeks, Phase 2
 *   (iOS migration release) ~2 weeks, Phase 3 (residual monitoring) ≥4
 *   weeks → sunset 3 months out from when this landed.
 * - Moved to 2026-11-01 on 2026-08-01, with the plan re-aimed. Same
 *   3-month cadence; different blockers than the original assumed.
 *
 * What the evidence actually shows (measured 2026-08-01):
 *
 * - **iOS is ~97% migrated** — 240 `/api/v1/*` references in app code
 *   against 8 legacy endpoints. The original plan treated iOS as the long
 *   pole. It isn't, and hasn't been for a while.
 * - **iOS's remaining 8 calls have nowhere to go.** There are NO v1
 *   WebAuthn routes (`/api/v1/auth/` has apple / google / mobile-session /
 *   signout / mobile-mcp-token and no passkey endpoints), and no
 *   `/api/v1/reminders/status`. That is a v1 parity gap, not client
 *   inertia — closing it frees iOS from the legacy surface entirely.
 * - **The web client is the volume consumer** (~21 `/api/lists/` and ~16
 *   `/api/tasks/` call sites, plus a long `/api/user/*` tail), and every
 *   legacy hit observed in production traffic was a browser. It is quick
 *   to migrate and should not be treated as a blocker.
 * - **`/api/auth/*` can never be deleted** — NextAuth's mount point lives
 *   there and web session auth runs through it, and the passkey routes are
 *   the same cookie-based web-session auth (decision 2, 2026-08-09). "Delete
 *   legacy /api/*" is therefore not achievable as literally stated. The real
 *   goal is: delete the legacy routes that have a v1 successor and no
 *   residual traffic, permanently exempting all of `/api/auth/`. Those routes
 *   are excluded from the census too — a number that can never reach zero is
 *   noise in a "delete when this hits zero" metric.
 *
 * The honest remaining blocker is MEASUREMENT. This module's premise is
 * "delete when residual traffic hits zero", but Vercel's runtime-logs
 * endpoint only retains a window of minutes — far too short to retire a
 * route on. Accumulating `deprecation:legacy-api` over weeks needs a log
 * drain or the Observability API. Until that exists, any deletion is a
 * guess wearing a data-driven costume.
 *
 * The companion test asserts this date is in the future. That is deliberate:
 * it is a tripwire that fires the moment the sunset arrives, forcing exactly
 * this decision instead of letting the header quietly start lying. Do not
 * weaken the test to make it pass — move the date, or actually delete the
 * legacy routes.
 */
export const LEGACY_SUNSET_HTTP_DATE = 'Sun, 01 Nov 2026 00:00:00 GMT'

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
 * Routes that are legacy-looking and iOS-facing but are **permanently exempt**
 * from retirement (task 641a7615, decision 2 — Jon, 2026-08-09).
 *
 * Kept separate from INTERNAL_PREFIXES on purpose: those are excluded because
 * they are infrastructure, these because they can never be deleted. Merging
 * the two lists would lose the reason, and the reason is the whole point when
 * someone later asks why passkey traffic is missing from the census.
 *
 * All of these are **cookie-based web-session auth**. `/api/auth/[...nextauth]`
 * is NextAuth's mount point and was already documented as undeletable — it was
 * nonetheless being counted, inflating the very census this module feeds. The
 * passkey routes sit in the same position: `authenticate/verify` mints a
 * NextAuth JWT and sets it as a session cookie, and `/api/v1/auth/mobile-session`
 * exists specifically to read that cookie back.
 *
 * Building v1 aliases for them would put a second live login surface on a
 * different path while changing nothing about the auth model — a rename
 * dressed as a migration. So they are exempt, not migrated.
 */
/**
 * The explicit routes under `/api/auth/` that DO have a v1 successor and are
 * therefore still part of the retirement. Everything else under `/api/auth/`
 * is served by the `[...nextauth]` catch-all.
 *
 * Mirrors the directories in `app/api/auth/`. Adding a new explicit auth route
 * means adding it here too, or it will be treated as NextAuth's and silently
 * stop being counted — the list sits next to the directory for that reason.
 */
const MIGRATABLE_AUTH_ROUTES = [
  'apple',
  'google',
  'mobile-session',
  'mobile-signup',
  'mobile-mcp-token',
] as const

/** `/api/auth/webauthn/*` — passkeys. Cookie-based web-session auth. */
const WEBAUTHN_PREFIX = '/api/auth/webauthn/'

/**
 * True for `/api/auth/*` paths that are permanently exempt: the passkey routes
 * and anything the NextAuth catch-all serves (session, csrf, signin, signout,
 * callback/*, …).
 */
function isPermanentlyExemptAuthPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/auth/')) return false
  if (pathname.startsWith(WEBAUTHN_PREFIX)) return true

  const segment = pathname.slice('/api/auth/'.length).split('/')[0]
  return !(MIGRATABLE_AUTH_ROUTES as readonly string[]).includes(segment)
}

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
    // A prefix written with a trailing slash also covers the bare route at
    // that exact path. Without this, `/api/assistant-workflow/x` was excluded
    // while `/api/assistant-workflow` — a real route, called server-to-server
    // from a Prisma middleware on ordinary writes — was counted as legacy
    // traffic that could never reach zero. The slash still has to be there in
    // the prefix, so `/api/admin` cannot swallow `/api/administrators`.
    if (prefix.endsWith('/') && pathname === prefix.slice(0, -1)) return false
  }
  if (isPermanentlyExemptAuthPath(pathname)) return false
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
