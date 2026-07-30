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
}
