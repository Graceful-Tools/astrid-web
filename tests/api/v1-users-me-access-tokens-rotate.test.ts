/**
 * POST /api/v1/users/me/access-tokens/:id/rotate — AWTD-1567.
 *
 * The visible way to replace a scoped (or unscoped) access token: same grant,
 * new secret, old one revoked. Rotation must never change what a token can do.
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
const mockTokenFindFirst = vi.hoisted(() => vi.fn())
const mockTokenCreate = vi.hoisted(() => vi.fn())
const mockTokenUpdate = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => {
  const mCPToken = { findFirst: mockTokenFindFirst, create: mockTokenCreate, update: mockTokenUpdate }
  return {
    prisma: {
      user: { findUnique: mockUserFindUnique },
      mCPToken,
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ mCPToken }),
    },
  }
})
vi.mock('@/lib/mcp-token', () => ({
  mcpTokenStorageFields: () => ({ token: 'hashed-token', tokenEncrypted: 'encrypted-token' }),
}))

import { POST } from '@/app/api/v1/users/me/access-tokens/[id]/rotate/route'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockAuth = vi.mocked(authenticateAPI)
const user = { id: 'owner-id', email: 'jon@example.com', name: 'Jon', isAIAgent: false }
const session = { userId: 'owner-id', source: 'session' as const, scopes: ['*'], isAIAgent: false, user }

const CREATED = new Date('2026-11-01T00:00:00Z')
const oldToken = {
  id: 'tok-old',
  permissions: ['read'],
  scope: 'tasks:read comments:read',
  agentUserId: 'copilot-agent-id',
  agentMailbox: 'copilot',
  description: 'Reporter',
  expiresAt: new Date(CREATED.getTime() + 30 * 24 * 60 * 60 * 1000),
  createdAt: CREATED,
}

const rotate = (id = 'tok-old') =>
  POST(new NextRequest(`http://localhost/api/v1/users/me/access-tokens/${id}/rotate`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  })

describe('POST /api/v1/users/me/access-tokens/:id/rotate (AWTD-1567)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(session)
    mockUserFindUnique.mockResolvedValue({ mcpEnabled: true })
    mockTokenFindFirst.mockResolvedValue(oldToken)
    mockTokenCreate.mockImplementation(async ({ data }) => ({ id: 'tok-new', ...data, createdAt: new Date() }))
  })

  it('AWTD-1567: mints a replacement with the same grant and revokes the old token', async () => {
    const before = Date.now()
    const res = await rotate()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true, id: 'tok-new', replacedId: 'tok-old',
      permissions: ['read'], scopes: ['tasks:read', 'comments:read'], description: 'Reporter',
    })
    expect(body.token).toMatch(/^astrid_mcp_[a-f0-9]{64}$/)
    const data = mockTokenCreate.mock.calls[0][0].data
    expect(data).toMatchObject({
      userId: 'owner-id', listId: null, agentUserId: 'copilot-agent-id', agentMailbox: 'copilot',
      permissions: ['read'], scope: 'tasks:read comments:read', isActive: true,
    })
    // Same 30-day lifetime, counted from now.
    const lifetime = new Date(data.expiresAt).getTime() - before
    expect(lifetime).toBeGreaterThanOrEqual(30 * 24 * 60 * 60 * 1000 - 1000)
    expect(lifetime).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 5000)
    expect(mockTokenUpdate).toHaveBeenCalledWith({ where: { id: 'tok-old' }, data: { isActive: false } })
    expect(mockTokenFindFirst.mock.calls[0][0].where).toMatchObject({
      id: 'tok-old', userId: 'owner-id', listId: null, isActive: true,
    })
  })

  it('AWTD-1567: an unscoped token rotates to an unscoped token with no expiry', async () => {
    mockTokenFindFirst.mockResolvedValue({ ...oldToken, scope: null, expiresAt: null })
    const body = await (await rotate()).json()
    expect(body.scopes).toBeNull()
    expect(body.expiresAt).toBeNull()
    expect(mockTokenCreate.mock.calls[0][0].data).toMatchObject({ scope: null, expiresAt: null })
  })

  it('AWTD-1567: 404 for a token that is not the caller\'s, revoked, or list-level', async () => {
    mockTokenFindFirst.mockResolvedValue(null)
    const res = await rotate('tok-someone-else')
    expect(res.status).toBe(404)
    expect(mockTokenCreate).not.toHaveBeenCalled()
    expect(mockTokenUpdate).not.toHaveBeenCalled()
  })

  it('AWTD-1567: refuses a token caller — a leaked token must not rotate itself', async () => {
    mockAuth.mockResolvedValue({ ...session, source: 'legacy_mcp' as const })
    expect((await rotate()).status).toBe(403)
    mockAuth.mockResolvedValue({ ...session, source: 'oauth' as const, scopes: ['user:write'] })
    expect((await rotate()).status).toBe(403)
    expect(mockTokenCreate).not.toHaveBeenCalled()
  })

  it('AWTD-1567: 403 when MCP access is disabled for the account', async () => {
    mockUserFindUnique.mockResolvedValue({ mcpEnabled: false })
    expect((await rotate()).status).toBe(403)
    expect(mockTokenCreate).not.toHaveBeenCalled()
  })
})
