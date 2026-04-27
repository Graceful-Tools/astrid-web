import { registerOTel } from '@vercel/otel'

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
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME ?? 'astrid-web',
  })
}
