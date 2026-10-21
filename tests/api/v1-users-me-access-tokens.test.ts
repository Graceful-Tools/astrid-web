/**
 * POST /api/v1/users/me/access-tokens — AWTD-1312.
 *
 * The Copilot cloud agent's token was minted only at POST /api/mcp/user-tokens,
 * the one route in the agent-settings surface outside /api/v1, so the native
 * clients (held to v1) could not offer the step. This is its v1 twin: same
 * body, same token, listed and revoked through /api/v1/users/me/connections.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

const mockUserFindUnique = vi.hoisted(() => vi.fn())
const mockTokenCreate = vi.hoisted(() => vi.fn())
const mockEnsureAgentUser = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    mCPToken: { create: mockTokenCreate },
  },
}))
vi.mock('@/lib/mcp-token', () => ({
  mcpTokenStorageFields: () => ({ token: 'hashed-token', tokenEncrypted: 'encrypted-token' }),
}))
vi.mock('@/lib/ai/ensure-agent-user', () => ({ ensureAgentUser: mockEnsureAgentUser }))

import { POST } from '@/app/api/v1/users/me/access-tokens/route'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { BRAND } from '@/lib/brand/config'

const mockAuth = vi.mocked(authenticateAPI)

const user = { id: 'owner-id', email: 'jon@example.com', name: 'Jon', isAIAgent: false }
const session = { userId: 'owner-id', source: 'session' as const, scopes: ['*'], isAIAgent: false, user }

const post = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/users/me/access-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

const copilotBody = {
  permissions: ['read', 'write'],
  expiresInDays: 90,
  description: 'GitHub Copilot cloud agent',
  agent: 'copilot',
}

describe('POST /api/v1/users/me/access-tokens (AWTD-1312)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(session)
    mockUserFindUnique.mockResolvedValue({ mcpEnabled: true })
    mockEnsureAgentUser.mockResolvedValue({
      id: 'copilot-agent-id',
      email: `copilot@${BRAND.agentEmailDomain}`,
      name: 'GitHub Copilot Agent',
      image: null,
    })
    mockTokenCreate.mockImplementation(async ({ data }) => ({
      ...data,
      createdAt: new Date('2026-10-21T00:00:00Z'),
    }))
  })

  it('AWTD-1312: mints a Copilot-bound token for a session caller, with the v1 meta', async () => {
    const res = await POST(post(copilotBody))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.token).toMatch(/^astrid_mcp_[a-f0-9]{64}$/)
    expect(body.permissions).toEqual(['read', 'write'])
    expect(body.description).toBe('GitHub Copilot cloud agent')
    expect(body.meta).toEqual({ apiVersion: 'v1', authSource: 'session' })
    expect(mockEnsureAgentUser).toHaveBeenCalledWith(`copilot@${BRAND.agentEmailDomain}`)
    expect(mockTokenCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'owner-id',
        listId: null,
        agentUserId: 'copilot-agent-id',
        agentMailbox: 'copilot',
        isActive: true,
      }),
    })
  })

  it('AWTD-1312: refuses a delegated OAuth token — a minted bearer would outlive revoking it', async () => {
    mockAuth.mockResolvedValue({ ...session, source: 'oauth' as const, scopes: ['user:write'] })

    const res = await POST(post(copilotBody))

    expect(res.status).toBe(403)
    expect(mockTokenCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1312: refuses an access token minting another access token', async () => {
    mockAuth.mockResolvedValue({ ...session, source: 'legacy_mcp' as const })

    const res = await POST(post(copilotBody))

    expect(res.status).toBe(403)
    expect(mockTokenCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1312: 403 when MCP access is disabled for the account', async () => {
    mockUserFindUnique.mockResolvedValue({ mcpEnabled: false })

    const res = await POST(post(copilotBody))

    expect(res.status).toBe(403)
    expect(mockTokenCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1312: 409 when the agent identity cannot be resolved', async () => {
    mockEnsureAgentUser.mockResolvedValue(null)

    const res = await POST(post(copilotBody))

    expect(res.status).toBe(409)
    expect(mockTokenCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1312: 400 for an empty permission list or an unknown agent', async () => {
    expect((await POST(post({ permissions: [] }))).status).toBe(400)
    expect((await POST(post({ permissions: ['read'], agent: 'nobody' }))).status).toBe(400)
    expect(mockTokenCreate).not.toHaveBeenCalled()
  })
})
