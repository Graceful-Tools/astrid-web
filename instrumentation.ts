import { registerOTel } from '@vercel/otel'
import {
  assertCoherentCapabilities,
  assertGithubProjectsCredentials,
  assertUsableAuthConfiguration,
} from '@/lib/brand/capabilities'

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

  // Same reasoning for a capability switched on without the one it is built on:
  // GitHub Projects with Project Mode off binds boards nobody can open (AWTD-1121).
  assertCoherentCapabilities()

  // And GitHub Projects without its App credentials, which degraded silently to the
  // hourly reconcile instead of failing (AWTD-1282).
  assertGithubProjectsCredentials()

  // Self-hosted storage with half its settings would accept the upload request
  // and lose the file (AWTD-1286). Vercel Blob, the default, needs nothing here.
  // Node only: storage is never touched from the edge, and importing the drivers
  // there would pull node:fs into the edge bundle.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertStorageConfiguration } = await import('@/lib/storage/object-store')
    assertStorageConfiguration()

    // Same for email: EMAIL_TRANSPORT=smtp with no relay would accept every
    // invitation and deliver none (AWTD-1466). Unset means Resend, unchanged.
    const { assertEmailConfiguration } = await import('@/lib/email-transport')
    assertEmailConfiguration()

    const { assertRealtimeConfiguration } = await import('@/lib/realtime/bus')
    assertRealtimeConfiguration()
  }

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
  // server component asks lib/list-permissions.ts, which this installs the core into. Since ADEV-304
  // it is the ONLY rule: there is no TypeScript fallback, so a process without it would refuse every
  // permission check while still answering 200. That is fatal here, on purpose, like the
  // configuration checks above: every request (and /api/health) fails, so the deployment
  // workflow's health check goes red and the build can be rolled back, instead of serving an app
  // nobody can edit in that looks healthy.
  // ASTRID_CORE_RULES no longer switches list permissions off. The edge runtime never asks
  // (tests/middleware/middleware-edge-safety.test.ts); the browser installs its own door.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { installListPermissionsCore, assertListPermissionsCoreInstalled } = await import(
      '@/lib/core-rules/list-permissions-core'
    )
    installListPermissionsCore()
    assertListPermissionsCoreInstalled()
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
    // The project board too (AWTD-1585): lib/board-core-hook.ts, behind getProjectBoardColumns /
    // resolveProjectColumnMove and boardColumnsFor / resolveColumnMove. Same setting, same fallback,
    // pinned by the shared board fixture.
    try {
      const { installBoardCore } = await import('@/lib/core-rules/board-core')
      installBoardCore()
    } catch (error) {
      console.error('board: astrid-core module failed to import; the TypeScript decides', error)
    }
    // The Waiting lane (Jon, 2026-11-12): lib/waiting-rules.ts's waitingWrite / waitingSettle /
    // boardPresets, behind every task write that can move a task into or out of Waiting and the
    // scheduled settle job. Core-first: astrid-core's waiting.json is the contract.
    try {
      const { installWaitingCore } = await import('@/lib/core-rules/waiting-core')
      installWaitingCore()
    } catch (error) {
      console.error('waiting: astrid-core module failed to import; the TypeScript decides', error)
    }
    // The Pending results lane (ADEV-274, ADEV-279): lib/results-rules.ts's resultsWrite / resultsSettle.
    try {
      const { installResultsCore } = await import('@/lib/core-rules/results-core')
      installResultsCore()
    } catch (error) {
      console.error('results: astrid-core module failed to import; the TypeScript decides', error)
    }
  }
}
