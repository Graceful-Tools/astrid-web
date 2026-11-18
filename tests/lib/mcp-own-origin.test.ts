/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mcpDefaultBaseUrl, mcpHostedBaseUrl } from '@/lib/brand/config'
import { mcpBackendUrl } from '@/lib/security/mcp-backend'
import { mcpRequestBaseUrl } from '@/lib/server/mcp-http-utils'

vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  UnauthorizedError: class extends Error {},
}))

afterEach(() => vi.unstubAllEnvs())

describe('ADEV-99 hosted /mcp calls its own origin, not the brand domain', () => {
  it('falls back to NEXTAUTH_URL before the brand domain', () => {
    vi.stubEnv('ASTRID_API_BASE_URL', '')
    vi.stubEnv('NEXTAUTH_URL', 'https://tasks.partner.example/')
    expect(mcpHostedBaseUrl()).toBe('https://tasks.partner.example')
  })

  it('still prefers an explicit ASTRID_API_BASE_URL', () => {
    vi.stubEnv('ASTRID_API_BASE_URL', 'http://web:3000')
    vi.stubEnv('NEXTAUTH_URL', 'https://tasks.partner.example')
    expect(mcpHostedBaseUrl()).toBe('http://web:3000')
  })

  it('trusts the operator-set NEXTAUTH_URL backend even on a private address', () => {
    vi.stubEnv('ASTRID_API_BASE_URL', '')
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')
    expect(mcpBackendUrl(mcpHostedBaseUrl()).origin).toBe('http://localhost:3000')
  })

  it('leaves the CLI default alone: a dev machine NEXTAUTH_URL of localhost is not the API', () => {
    vi.stubEnv('ASTRID_API_BASE_URL', '')
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')
    expect(mcpDefaultBaseUrl()).not.toBe('http://localhost:3000')
  })

  it('names the configured origin in the OAuth challenge, not a proxied Host', () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://tasks.partner.example')
    const req = { headers: { host: 'localhost:3000' } } as never
    expect(mcpRequestBaseUrl(req)).toBe('https://tasks.partner.example')
  })

  it('uses the Host header when NEXTAUTH_URL is unset', () => {
    vi.stubEnv('NEXTAUTH_URL', '')
    const req = { headers: { host: 'app.example' } } as never
    expect(mcpRequestBaseUrl(req)).toBe('https://app.example')
  })
})
