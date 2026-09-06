/**
 * RED for task 866a4891 — routes that proved "somebody is signed in" and then
 * acted on an identity or id taken from the request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'

describe('reminders/status', () => {
  const source = fs.readFileSync('app/api/reminders/status/route.ts', 'utf8')

  it('no longer lets a query parameter choose whose reminders to read', () => {
    // ?userEmail= overrode the session "for debugging purposes", so any user
    // could read any other user's pending reminder queue.
    expect(source).not.toMatch(/searchParams\.get\(['"]userEmail['"]\)/)
    expect(source).toContain('const targetUserId = session.user.id')
  })
})

describe('remote-servers/callback', () => {
  const source = fs.readFileSync('app/api/remote-servers/callback/route.ts', 'utf8')

  it('does not retry a failed user secret against the deployment-wide secret', () => {
    // Every operator-run remote worker holds CLAUDE_REMOTE_WEBHOOK_SECRET, so
    // that retry let any of them post onto a task whose creator had their own.
    expect(source).not.toMatch(/if user config failed, try env secret/i)
    expect(source).not.toMatch(/envVerification/)
  })
})

describe('oauth discovery documents', () => {
  it('do not reflect an arbitrary forwarded host', () => {
    for (const route of [
      'app/.well-known/oauth-authorization-server/route.ts',
      'app/.well-known/oauth-protected-resource/mcp/route.ts',
    ]) {
      const source = fs.readFileSync(route, 'utf8')
      expect(source).toContain('resolveDiscoveryBaseUrl')
      expect(source).not.toContain('x-forwarded-host')
    }
  })

  it('gates the authorization-server document on the MCP capability', () => {
    const source = fs.readFileSync('app/.well-known/oauth-authorization-server/route.ts', 'utf8')
    expect(source).toContain("capabilityGate('integrationMcp')")
  })
})

describe('resolveDiscoveryBaseUrl', () => {
  const headers = vi.hoisted(() => vi.fn())
  vi.mock('next/headers', () => ({ headers }))
  vi.mock('@/lib/base-url', () => ({ getBaseUrl: () => 'https://astrid.cc/' }))

  beforeEach(() => vi.clearAllMocks())

  function withHost(host: string | null) {
    headers.mockResolvedValue({
      get: (name: string) => (name === 'x-forwarded-host' ? host : null),
    })
  }

  it('honours a preview subdomain of the brand domain', async () => {
    const { resolveDiscoveryBaseUrl } = await import('@/lib/oauth/discovery-base-url')
    withHost('feature-x.astrid.cc')

    expect(await resolveDiscoveryBaseUrl()).toBe('https://feature-x.astrid.cc')
  })

  it('ignores an attacker-supplied host and falls back to the configured base URL', async () => {
    const { resolveDiscoveryBaseUrl } = await import('@/lib/oauth/discovery-base-url')
    withHost('evil.test')

    expect(await resolveDiscoveryBaseUrl()).toBe('https://astrid.cc')
  })

  it('is not fooled by a lookalike domain', async () => {
    const { resolveDiscoveryBaseUrl } = await import('@/lib/oauth/discovery-base-url')
    withHost('evil-astrid.cc')

    expect(await resolveDiscoveryBaseUrl()).toBe('https://astrid.cc')
  })
})
