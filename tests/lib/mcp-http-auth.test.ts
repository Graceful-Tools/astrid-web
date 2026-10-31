/**
 * @vitest-environment node
 *
 * AITD-447: validate the credential actually forwarded by hosted MCP, never an
 * ambient NextAuth session. All token lookups and sessions are isolated fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BRAND, brandOrigin } from '@/lib/brand/config'
import { NextRequest } from 'next/server'
import { GET as validateToken } from '@/app/api/v1/oauth/validate/route'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { validateAccessToken } from '@/lib/oauth/oauth-token-manager'
import { validateMCPAuthContext } from '@/lib/server/mcp-http-utils'
import { UnauthorizedError } from '@/lib/api-auth-middleware'
import { row, rowWith } from '../fixtures/prisma-rows'

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth-config', () => ({ authConfig: {} }))
vi.mock('@/lib/oauth/oauth-token-manager', () => ({ validateAccessToken: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { mCPToken: { findFirst: vi.fn() }, user: { findUnique: vi.fn() } },
}))

const user = { id: 'fixture-user', email: 'fixture@example.test', name: null, isAIAgent: false }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(validateAccessToken).mockResolvedValue(null)
  vi.mocked(prisma.mCPToken.findFirst).mockResolvedValue(null)
  vi.mocked(getServerSession).mockResolvedValue({ user, expires: '2099-01-01' })
  vi.mocked(prisma.user.findUnique).mockResolvedValue(row(user))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
})
afterEach(() => vi.unstubAllGlobals())

describe('AITD-447 hosted credential validation', () => {
  it('validates a cross-deployment bearer on its selected backend, not the host database', async () => {
    const baseUrl = `https://preview.${BRAND.domain}`
    await expect(validateMCPAuthContext({
      accessToken: 'astrid_fixture_remote', baseUrl,
    }, brandOrigin())).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/oauth/validate`, expect.objectContaining({
      redirect: 'error',
      headers: { Authorization: 'Bearer astrid_fixture_remote' },
    }))
    expect(validateAccessToken).not.toHaveBeenCalled()
  })

  it('honors the environment-selected backend when no request override exists', async () => {
    const baseUrl = `https://staging.${BRAND.domain}`
    vi.stubEnv('ASTRID_API_BASE_URL', baseUrl)
    try {
      await validateMCPAuthContext({ accessToken: 'astrid_fixture_remote' }, brandOrigin())
      expect(fetch).toHaveBeenCalledWith(`${baseUrl}/api/v1/oauth/validate`, expect.anything())
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([403, 404, 500])('does not call remote HTTP %s an expired bearer', async status => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }))
    await expect(validateMCPAuthContext({
      accessToken: 'astrid_fixture_remote', baseUrl: `https://preview.${BRAND.domain}`,
    })).rejects.not.toBeInstanceOf(UnauthorizedError)
  })

  it('reports a remote rejected bearer as unauthorized', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }))
    await expect(validateMCPAuthContext({
      accessToken: 'astrid_fixture_remote', baseUrl: `https://preview.${BRAND.domain}`,
    })).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('the remote validation endpoint refuses cookie fallback and discloses no token metadata', async () => {
    const response = await validateToken(new NextRequest(`${brandOrigin()}/api/v1/oauth/validate`, {
      headers: { Authorization: 'Bearer astrid_fixture_invalid', Cookie: 'fixture-cookie' },
    }))
    expect(response.status).toBe(401)
    expect(getServerSession).not.toHaveBeenCalled()

    vi.mocked(validateAccessToken).mockResolvedValue({
      userId: user.id, clientId: 'fixture-client', scopes: [], user, agentUser: null,
    })
    const valid = await validateToken(new NextRequest(`${brandOrigin()}/api/v1/oauth/validate`, {
      headers: { Authorization: 'Bearer astrid_fixture_valid' },
    }))
    expect(valid.status).toBe(204)
    expect(await valid.text()).toBe('')
    expect(valid.headers.get('Cache-Control')).toBe('no-store')
  })

  it.each(['astrid_fixture_expired', 'astrid_mcp_fixture_revoked', 'fixture_unknown'])(
    'rejects %s even when an ambient browser session exists', async accessToken => {
      await expect(validateMCPAuthContext({ accessToken })).rejects.toBeInstanceOf(UnauthorizedError)
      expect(getServerSession).not.toHaveBeenCalled()
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
    },
  )

  it('accepts a valid OAuth bearer through the existing validator', async () => {
    vi.mocked(validateAccessToken).mockResolvedValue({
      userId: user.id, clientId: 'fixture-client', scopes: ['tasks:read'], user, agentUser: null,
    })
    await expect(validateMCPAuthContext({ accessToken: 'astrid_fixture_valid' })).resolves.toBeUndefined()
    expect(validateAccessToken).toHaveBeenCalledWith('astrid_fixture_valid')
  })

  it('accepts a valid legacy MCP bearer through the existing validator', async () => {
    vi.mocked(prisma.mCPToken.findFirst).mockResolvedValue(rowWith({
      userId: user.id, permissions: ['read'], user, agentUser: null, agentMailbox: null,
    }))
    await expect(validateMCPAuthContext({ accessToken: 'astrid_mcp_fixture_valid' })).resolves.toBeUndefined()
    expect(prisma.mCPToken.findFirst).toHaveBeenCalledOnce()
    expect(getServerSession).not.toHaveBeenCalled()
  })

  it('propagates a backend outage rather than calling it an invalid token', async () => {
    const outage = new Error('fixture database unavailable')
    vi.mocked(validateAccessToken).mockRejectedValue(outage)
    await expect(validateMCPAuthContext({ accessToken: 'astrid_fixture_valid' })).rejects.toBe(outage)
  })

  it('leaves Basic client credentials to the existing token exchange', async () => {
    await expect(validateMCPAuthContext({ clientId: 'fixture-client', clientSecret: 'fixture-only' }))
      .resolves.toBeUndefined()
    expect(validateAccessToken).not.toHaveBeenCalled()
    expect(prisma.mCPToken.findFirst).not.toHaveBeenCalled()
  })
})
