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
  }
}
