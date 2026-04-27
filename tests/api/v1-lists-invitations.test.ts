import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findUnique: vi.fn(),
    },
    listMember: {
      findMany: vi.fn(),
    },
    listInvite: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

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

import { GET, DELETE } from '@/app/api/v1/lists/[id]/invitations/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const authedUser = {
  userId: 'owner-123',
  source: 'oauth' as const,
  scopes: ['lists:read', 'lists:write'],
  isAIAgent: false,
  user: { id: 'owner-123', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(method: 'GET' | 'DELETE', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/lists/list-1/invitations', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const params = Promise.resolve({ id: 'list-1' })

const ownedList = {
  id: 'list-1',
  ownerId: 'owner-123',
  owner: { id: 'owner-123' },
  listMembers: [],
}

const foreignList = {
  id: 'list-1',
  ownerId: 'someone-else',
  owner: { id: 'someone-else' },
  listMembers: [],
}

describe('GET /api/v1/lists/:id/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
    ;(mockPrisma.listMember.findMany as any).mockResolvedValue([])
  })

  it('returns 404 when list does not exist', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(null as any)
    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is neither owner nor admin', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(foreignList as any)
    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(403)
  })

  it('returns invitations to list owners', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(ownedList as any)
    ;(mockPrisma.listInvite.findMany as any).mockResolvedValue([
      {
        id: 'invite-1',
        email: 'guest@example.com',
        role: 'member',
        createdAt: new Date('2026-04-01T10:00:00Z'),
        creator: { id: 'owner-123', name: 'Jon', email: 'jon@example.com' },
      },
    ])

    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.invitations).toHaveLength(1)
    expect(json.invitations[0]).toMatchObject({
      id: 'invite-1',
      email: 'guest@example.com',
      role: 'member',
      createdBy: { id: 'owner-123', email: 'jon@example.com' },
    })
  })

  it('excludes invitations whose email already joined the list', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(ownedList as any)
    ;(mockPrisma.listMember.findMany as any).mockResolvedValue([
      { user: { email: 'joined@example.com' } },
    ])
    ;(mockPrisma.listInvite.findMany as any).mockResolvedValue([])

    await GET(makeReq('GET'), { params } as any)

    const findManyCall = (mockPrisma.listInvite.findMany as any).mock.calls[0][0]
    expect(findManyCall.where.NOT.email.in).toContain('joined@example.com')
  })
})

describe('DELETE /api/v1/lists/:id/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 400 when email is missing', async () => {
    const res = await DELETE(makeReq('DELETE', {}), { params } as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when list does not exist', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(null as any)
    const res = await DELETE(
      makeReq('DELETE', { email: 'guest@example.com' }),
      { params } as any
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not owner/admin', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(foreignList as any)
    const res = await DELETE(
      makeReq('DELETE', { email: 'guest@example.com' }),
      { params } as any
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 when invitation does not exist', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(ownedList as any)
    ;(mockPrisma.listInvite.deleteMany as any).mockResolvedValue({ count: 0 })

    const res = await DELETE(
      makeReq('DELETE', { email: 'noone@example.com' }),
      { params } as any
    )
    expect(res.status).toBe(404)
  })

  it('cancels invitation when caller is the owner (lowercases email)', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(ownedList as any)
    ;(mockPrisma.listInvite.deleteMany as any).mockResolvedValue({ count: 1 })

    const res = await DELETE(
      makeReq('DELETE', { email: 'GUEST@example.com' }),
      { params } as any
    )
    expect(res.status).toBe(200)
    expect(mockPrisma.listInvite.deleteMany).toHaveBeenCalledWith({
      where: { listId: 'list-1', email: 'guest@example.com' },
    })
  })
})
