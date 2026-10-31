/**
 * @vitest-environment node
 *
 * AITD-447: validate the credential actually forwarded by hosted MCP, never an
 * ambient NextAuth session. All token lookups and sessions are isolated fixtures.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})

describe('AITD-447 hosted credential validation', () => {
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
