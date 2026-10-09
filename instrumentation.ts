import { registerOTel } from '@vercel/otel'
import { assertUsableAuthConfiguration } from '@/lib/brand/capabilities'

/**
 * Server-side OpenTelemetry instrumentation.
 *
 * Captures spans for incoming requests, Prisma queries, and outgoing fetch
 * calls (AI clients, GitHub, OAuth, etc.). Surfaces in Vercel's Observability
 * tab — search by trace, filter by route, drill into slow segments.
 *
 * Next.js auto-loads this file at server start. No imports from app code.
 *
 * Why we don't add a manual Sentry SDK: Vercel Observability already groups
 * errors from Function logs and ties them to traces via OTEL context. Adding
 * a second SDK would duplicate stack traces in two dashboards.
 */
export async function register() {
  // Fail at server start, not at the first user's sign-in attempt.
  //
  // A brand configuration that disables every authentication method renders a sign-in
  // page with no buttons and a 200 status — indistinguishable from a working page.
  // lib/auth-config.ts asserts the same thing, but only loads when an /api/auth/* route
  // is hit, so a broken deployment could look healthy for as long as nobody tried to
  // sign in. This hook runs once per server start regardless of route. Task 97208a72.
  assertUsableAuthConfiguration()

  // Every listed provider must have what it needs (spec §6.2). Missing
  // credentials for GitHub or SSO stop the boot; for the legacy providers they
  // are logged, since a wrong guess about an existing deployment would be an
  // outage rather than a safety check.
  {
    const { AUTH_PROVIDERS } = await import('@/lib/brand/capabilities')
    const { checkProviderCredentials } = await import('@/lib/auth/provider-credentials')
    const credentials = checkProviderCredentials(AUTH_PROVIDERS)
    for (const warning of credentials.warnings) {
      console.error(`[auth] sign-in provider is missing configuration — ${warning}`)
    }
    if (credentials.fatal.length > 0) {
      throw new Error(`Sign-in providers are listed without their configuration: ${credentials.fatal.join('; ')}`)
    }
  }

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'astrid-web',
  })

  // astrid-core decides list permissions on the Node runtime (AWTD-1061): every route handler and
  // server component asks lib/list-permissions.ts, which this installs the core into. The core is
  // WebAssembly read from disk, which the edge runtime cannot do; there, in the browser, and if
  // anything here fails, the TypeScript rules decide — the same answers, pinned by the shared
  // permissions fixture. ASTRID_CORE_RULES=shadow|off is the rollback. Never fatal.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { installListPermissionsCore } = await import('@/lib/core-rules/list-permissions-core')
      installListPermissionsCore()
    } catch (error) {
      // Only reachable if the module itself fails to import; installListPermissionsCore never throws.
      console.error('list permissions: astrid-core module failed to import; the TypeScript rules decide', error)
    }
    // Search queries too (AWTD-1062): lib/search-query-parser.ts's parseSearchQuery, whose caller
    // is GET /api/v1/search. Same setting, same fallback, pinned by the shared search fixture.
    try {
      const { installSearchQueryCore } = await import('@/lib/core-rules/search-query-core')
      installSearchQueryCore()
    } catch (error) {
      console.error('search query: astrid-core module failed to import; the TypeScript parses', error)
    }
    // Repeating-task rollover too (AWTD-1063): lib/repeating-rollover.ts's nextOccurrenceForTask,
    // whose caller is the server's completion path (lib/repeating-task-handler.ts). Same setting,
    // same fallback, pinned by the shared repeating fixture.
    try {
      const { installRepeatingCore } = await import('@/lib/core-rules/repeating-core')
      installRepeatingCore()
    } catch (error) {
      console.error('repeating: astrid-core module failed to import; the TypeScript decides', error)
    }
  }
}
