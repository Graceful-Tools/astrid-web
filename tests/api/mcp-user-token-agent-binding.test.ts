import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mockSession = vi.hoisted(() => vi.fn())
const mockUserFindUnique = vi.hoisted(() => vi.fn())
const mockTokenCreate = vi.hoisted(() => vi.fn())
const mockTokenFindMany = vi.hoisted(() => vi.fn())
const mockTokenFindFirst = vi.hoisted(() => vi.fn())
const mockTokenUpdate = vi.hoisted(() => vi.fn())
const mockEnsureAgentUser = vi.hoisted(() => vi.fn())

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: mockSession }))
vi.mock('@/lib/brand/capabilities', () => ({ capabilityGate: () => null }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    mCPToken: {
      create: mockTokenCreate,
      findMany: mockTokenFindMany,
      findFirst: mockTokenFindFirst,
      update: mockTokenUpdate,
    },
  },
}))
vi.mock('@/lib/mcp-token', () => ({
  mcpTokenLookup: (token: string) => [`hash:${token}`, token],
  mcpTokenStorageFields: () => ({
    token: 'hashed-token',
    tokenEncrypted: 'encrypted-token',
  }),
  resolveMCPPlaintext: () => 'plain-token',
}))
vi.mock('@/lib/ai/ensure-agent-user', () => ({ ensureAgentUser: mockEnsureAgentUser }))

import { DELETE, GET, POST } from '@/app/api/mcp/user-tokens/route'

describe('GitHub Copilot MCP token binding (task d9e4aae0)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSession.mockResolvedValue({ user: { id: 'owner-id' } })
    mockUserFindUnique.mockResolvedValue({ mcpEnabled: true })
    mockEnsureAgentUser.mockResolvedValue({
      id: 'copilot-agent-id',
      email: 'copilot@astrid.cc',
      name: 'GitHub Copilot Agent',
      image: null,
    })
    mockTokenCreate.mockResolvedValue({
      token: 'hashed-token',
      tokenEncrypted: 'encrypted-token',
      permissions: ['read', 'write'],
      expiresAt: null,
      description: 'GitHub Copilot cloud agent',
      createdAt: new Date(),
    })
  })

  it('binds the owner-authorized token to the server-resolved Copilot agent', async () => {
    const request = new NextRequest('http://localhost/api/mcp/user-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        permissions: ['read', 'write'],
        description: 'GitHub Copilot cloud agent',
        agent: 'copilot',
      }),
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(mockEnsureAgentUser).toHaveBeenCalledWith('copilot@astrid.cc')
    expect(mockTokenCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'owner-id',
        agentUserId: 'copilot-agent-id',
        agentMailbox: 'copilot',
      }),
    })
  })

  it('returns the recoverable token rather than its database hash', async () => {
    mockTokenFindMany.mockResolvedValue([{
      token: 'hashed-token',
      tokenEncrypted: 'encrypted-token',
      permissions: ['read'],
      expiresAt: null,
      description: 'GitHub Copilot cloud agent',
      createdAt: new Date(),
    }])

    const response = await GET()

    await expect(response.json()).resolves.toMatchObject({
      tokens: [{ token: 'plain-token' }],
    })
  })

  it('revokes a hashed token using the presented plaintext', async () => {
    mockTokenFindFirst.mockResolvedValue({ id: 'token-id' })

    const response = await DELETE(new NextRequest(
      'http://localhost/api/mcp/user-tokens?token=plain-token',
      { method: 'DELETE' },
    ))

    expect(response.status).toBe(200)
    expect(mockTokenFindFirst).toHaveBeenCalledWith({
      where: {
        token: { in: ['hash:plain-token', 'plain-token'] },
        userId: 'owner-id',
        listId: null,
      },
    })
    expect(mockTokenUpdate).toHaveBeenCalledWith({
      where: { id: 'token-id' },
      data: { isActive: false },
    })
  })
})
