import { describe, it, expect } from 'vitest'
import {
  isLegacyApiPath,
  buildLegacyApiHit,
  buildDeprecationHeaders,
  LEGACY_SUNSET_HTTP_DATE,
} from '@/lib/api-deprecation'

describe('isLegacyApiPath', () => {
  /**
   * An internal prefix written with a trailing slash did not match the bare
   * route at that exact path. `/api/assistant-workflow/anything` was excluded
   * while `/api/assistant-workflow` — a real route, called server-to-server
   * from a Prisma middleware and two notifiers on ordinary writes — was
   * counted as legacy traffic.
   *
   * That is worse than a miscount. The census is what decides when a route is
   * safe to delete, and this one would have shown steady legacy traffic that
   * never reached zero no matter how thoroughly the clients migrated.
   */
  it('excludes the bare route at an internal prefix, not just its children', () => {
    expect(isLegacyApiPath('/api/assistant-workflow')).toBe(false)
    expect(isLegacyApiPath('/api/assistant-workflow/trigger')).toBe(false)
  })

  it('excludes the bare route for every slash-terminated internal prefix', () => {
    for (const path of ['/api/cron', '/api/admin', '/api/mcp', '/api/coding-workflow', '/api/agent-workflow', '/api/openclaw']) {
      expect(isLegacyApiPath(path)).toBe(false)
    }
  })

  it('does not let the prefix swallow a sibling that merely starts the same', () => {
    // `/api/admin` must not exclude `/api/administrators` — the prefix is a
    // path boundary, not a string prefix.
    expect(isLegacyApiPath('/api/administrators')).toBe(true)
  })

  // Routes the iOS app calls that are part of the migration surface.
  // If any of these stop being detected as legacy, deprecation
  // telemetry stops working for that route.
  it.each([
    '/api/tasks',
    '/api/tasks/abc-123',
    '/api/tasks/abc-123/copy',
    '/api/tasks/abc-123/comments',
    '/api/tasks/abc-123/attachments',
    '/api/lists',
    '/api/lists/abc-123',
    '/api/lists/abc-123/invite',
    '/api/lists/abc-123/leave',
    '/api/lists/abc-123/favorite',
    '/api/lists/public',
    '/api/comments/abc-123',
    '/api/reminders/status',
    '/api/reminders/abc-123/dismiss',
    '/api/reminders/abc-123/snooze',
    '/api/account',
    '/api/account/delete',
    '/api/account/verify-email',
    '/api/account/export',
    '/api/upload',
    '/api/users/abc/profile',
    '/api/users/search',
    '/api/secure-files/abc',
    '/api/secure-files/abc/upload-url',
    '/api/secure-files/abc/confirm-upload',
    '/api/secure-upload/request-upload',
    '/api/secure-upload/get-upload-url',
    '/api/user/settings',
    '/api/user/my-tasks-preferences',
    '/api/user/ai-api-keys',
    '/api/user/ai-assistant-settings',
    '/api/user/available-agents',
    '/api/user/ai-available-models',
    '/api/chat/channels',
    '/api/chat/channels/abc/messages',
    '/api/chat/channels/abc/agent-response',
    '/api/auth/mobile-signup',
    '/api/auth/mobile-session',
    '/api/auth/mobile-mcp-token',
    '/api/auth/apple',
    '/api/auth/google',
    '/api/invitations',
    '/api/shortcodes',
    '/api/shortcodes/abc',
    '/api/public-tasks',
    '/api/push/subscribe',
  ])('%s is legacy', path => {
    expect(isLegacyApiPath(path)).toBe(true)
  })

  // v1 surface — never counted as legacy. If these started matching, the
  // deprecation log would be self-referentially noisy.
  it.each([
    '/api/v1/tasks',
    '/api/v1/tasks/abc/comments',
    '/api/v1/lists',
    '/api/v1/lists/abc/members',
    '/api/v1/comments/abc',
    '/api/v1/contacts',
    '/api/v1/contacts/search',
    '/api/v1/shortcodes',
    '/api/v1/users/me/settings',
    '/api/v1/public/lists',
    '/api/v1/github/status',
    '/api/v1/openclaw/agents',
    '/api/v1/oauth/token',
    '/api/v1/agent/tasks',
    '/api/v1/agent/events',
  ])('%s is v1, NOT legacy', path => {
    expect(isLegacyApiPath(path)).toBe(false)
  })

  // Internal infrastructure routes — never iOS-facing, never counted.
  it.each([
    '/api/cron/reminders',
    '/api/cron/analytics',
    '/api/admin/analytics',
    '/api/mcp/operations',
    '/api/sse',
    '/api/sse/agent-events',
    '/api/health',
    '/api/coding-workflow/create',
    '/api/agent-workflow/something',
    '/api/assistant-workflow/something',
    '/api/github/webhooks',
    '/api/openclaw/some-agent-endpoint',
    '/api/debug-reminders',
    '/api/redis-debug',
  ])('%s is internal, NOT legacy', path => {
    expect(isLegacyApiPath(path)).toBe(false)
  })

  // Non-API paths must not match — middleware also runs on app routes.
  it.each([
    '/',
    '/dashboard',
    '/login',
    '/api',                  // exact prefix without trailing slash
    '/api-docs/something',   // similar prefix, not /api/
    '/.well-known/apple-app-site-association',
  ])('%s is not an API path', path => {
    expect(isLegacyApiPath(path)).toBe(false)
  })
})

describe('buildLegacyApiHit', () => {
  it('produces the canonical structured payload', () => {
    const headers = new Headers({
      'user-agent': 'Astrid/2.4.0 iOS',
      'x-vercel-id': 'iad1::abc123',
      'x-vercel-deployment-id': 'dpl_abc',
    })
    const hit = buildLegacyApiHit({
      pathname: '/api/tasks',
      method: 'GET',
      headers,
    })
    expect(hit.deprecation).toBe('legacy-api')
    expect(hit.route).toBe('/api/tasks')
    expect(hit.method).toBe('GET')
    expect(hit.userAgent).toBe('Astrid/2.4.0 iOS')
    expect(hit.requestId).toBe('iad1::abc123')
    expect(hit.deploymentId).toBe('dpl_abc')
    expect(hit.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('falls back to x-request-id when x-vercel-id is missing', () => {
    const headers = new Headers({ 'x-request-id': 'fallback-123' })
    const hit = buildLegacyApiHit({
      pathname: '/api/lists',
      method: 'POST',
      headers,
    })
    expect(hit.requestId).toBe('fallback-123')
  })

  it('emits null (not undefined) for missing headers', () => {
    // Vercel log queries treat null and missing-key differently; we
    // always emit null so the field is queryable.
    const hit = buildLegacyApiHit({
      pathname: '/api/tasks',
      method: 'GET',
      headers: new Headers(),
    })
    expect(hit.userAgent).toBeNull()
    expect(hit.requestId).toBeNull()
    expect(hit.deploymentId).toBeNull()
  })
})

describe('buildDeprecationHeaders', () => {
  it('produces the RFC 8594 trio', () => {
    const headers = buildDeprecationHeaders('/api/tasks')
    expect(headers.Deprecation).toBe('true')
    expect(headers.Sunset).toBe(LEGACY_SUNSET_HTTP_DATE)
    expect(headers.Link).toBe('</api/v1/tasks>; rel="successor-version"')
  })

  it('rewrites nested paths to their v1 successor', () => {
    expect(buildDeprecationHeaders('/api/lists/abc/members').Link).toBe(
      '</api/v1/lists/abc/members>; rel="successor-version"'
    )
  })

  // Some legacy routes have no direct v1 equivalent yet (e.g.
  // /api/upload → /api/v1/tasks/[id]/attachments is a reshape, not a
  // rename). The Link header still points at the v1 namespace; clients
  // following blindly will get a 404 they can log. That's better than
  // omitting the header.
  it('always provides a Link header even when the successor URL is approximate', () => {
    expect(buildDeprecationHeaders('/api/upload').Link).toContain('rel="successor-version"')
  })
})

describe('LEGACY_SUNSET_HTTP_DATE', () => {
  it('parses as a real date in the future', () => {
    const parsed = new Date(LEGACY_SUNSET_HTTP_DATE)
    expect(Number.isNaN(parsed.getTime())).toBe(false)

    // This is a deliberate tripwire, not an incidental assertion: it fires the
    // moment the advertised sunset arrives, so the date gets a conscious
    // decision instead of the Sunset header quietly starting to lie to
    // third-party callers. When it fails, the fix is to move the date in
    // lib/api-deprecation.ts (or actually delete the legacy routes) — never to
    // weaken this check.
    const daysRemaining = Math.round((parsed.getTime() - Date.now()) / 86_400_000)
    expect(
      parsed.getTime(),
      `LEGACY_SUNSET_HTTP_DATE (${LEGACY_SUNSET_HTTP_DATE}) is ${Math.abs(daysRemaining)} days in the PAST. ` +
        'The advertised sunset has arrived. Either delete the legacy /api/* routes, ' +
        'or move the date forward in lib/api-deprecation.ts as a deliberate planning decision.'
    ).toBeGreaterThan(Date.now())
  })

  it('names the correct weekday for its date', () => {
    // RFC 7231 §7.1.1.1 requires the day-name to agree with the date. A
    // hand-edited constant is exactly where that drifts, and a malformed
    // Sunset header is silently ignored by clients rather than erroring.
    const parsed = new Date(LEGACY_SUNSET_HTTP_DATE)
    const expected = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][parsed.getUTCDay()]
    expect(LEGACY_SUNSET_HTTP_DATE.startsWith(`${expected},`)).toBe(true)
  })

  it('is in HTTP-date (RFC 7231) format', () => {
    // Format: "Day, DD Mon YYYY HH:MM:SS GMT"
    expect(LEGACY_SUNSET_HTTP_DATE).toMatch(
      /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/
    )
  })
})

describe('permanently exempt auth routes (task 641a7615, decision 2)', () => {
  // These are cookie-based WEB SESSION auth. They can never be deleted, so
  // counting them in a census whose whole purpose is "delete when this hits
  // zero" is noise that can only ever mislead — the number never reaches zero
  // and nothing about that is actionable.
  it.each([
    '/api/auth/webauthn/register/options',
    '/api/auth/webauthn/register/verify',
    '/api/auth/webauthn/authenticate/options',
    '/api/auth/webauthn/authenticate/verify',
    '/api/auth/webauthn/passkeys',
  ])('does not count the passkey route %s', path => {
    expect(isLegacyApiPath(path)).toBe(false)
  })

  it.each([
    '/api/auth/session',
    '/api/auth/callback/google',
    '/api/auth/signin',
    '/api/auth/csrf',
    // Moved here from the legacy set by decision 2. There is no
    // app/api/auth/signout directory — this path is served by the
    // [...nextauth] catch-all, i.e. it is the BROWSER's signout and cannot be
    // deleted. /api/v1/auth/signout is a different thing that happens to share
    // a name: a v1 API route. The existence of the v1 one does not make the
    // NextAuth one migratable.
    '/api/auth/signout',
  ])('does not count the NextAuth mount %s', path => {
    // Documented since this module was written as never-deletable, but it was
    // still being counted — inflating the very census the retirement reads.
    expect(isLegacyApiPath(path)).toBe(false)
  })

  it('still counts the legacy routes that DO have a v1 successor', () => {
    // The exemption must stay narrow: broadening it would hide the traffic
    // this whole exercise exists to drive to zero.
    expect(isLegacyApiPath('/api/tasks')).toBe(true)
    expect(isLegacyApiPath('/api/lists')).toBe(true)
    expect(isLegacyApiPath('/api/user/settings')).toBe(true)
  })
})
