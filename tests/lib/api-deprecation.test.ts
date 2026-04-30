import { describe, it, expect } from 'vitest'
import {
  isLegacyApiPath,
  buildLegacyApiHit,
  buildDeprecationHeaders,
  LEGACY_SUNSET_HTTP_DATE,
} from '@/lib/api-deprecation'

describe('isLegacyApiPath', () => {
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
    '/api/auth/signout',
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
    expect(parsed.getTime()).toBeGreaterThan(Date.now())
  })

  it('is in HTTP-date (RFC 7231) format', () => {
    // Format: "Day, DD Mon YYYY HH:MM:SS GMT"
    expect(LEGACY_SUNSET_HTTP_DATE).toMatch(
      /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/
    )
  })
})
