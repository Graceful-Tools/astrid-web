import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findUnique: vi.fn(),
    },
    listMember: {
      update: vi.fn(),
      delete: vi.fn(),
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

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

vi.mock('@/lib/list-member-utils', async () => {
  const actual = await vi.importActual<typeof import('@/lib/list-member-utils')>('@/lib/list-member-utils')
  return { ...actual }
})

import { PUT, DELETE } from '@/app/api/v1/lists/[id]/members/[userId]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const adminAuth = {
  userId: 'admin-1',
  source: 'oauth' as const,
  scopes: ['lists:write'],
  isAIAgent: false,
  user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', isAIAgent: false },
}

const memberAuth = {
  userId: 'member-1',
  source: 'oauth' as const,
  scopes: ['lists:write'],
  isAIAgent: false,
  user: { id: 'member-1', email: 'mem@example.com', name: 'Mem', isAIAgent: false },
}

function makeReq(method: 'PUT' | 'DELETE', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/lists/list-1/members/member-1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const params = Promise.resolve({ id: 'list-1', userId: 'member-1' })
const paramsRemoveOwner = Promise.resolve({ id: 'list-1', userId: 'owner-1' })

const listWithAdminAndMember = {
  id: 'list-1',
  ownerId: 'owner-1',
  owner: { id: 'owner-1', name: 'Owner', email: 'owner@example.com', image: null },
  listMembers: [
    { userId: 'admin-1', role: 'admin', user: { id: 'admin-1', name: 'Admin', email: 'admin@example.com', image: null } },
    { userId: 'member-1', role: 'member', user: { id: 'member-1', name: 'Mem', email: 'mem@example.com', image: null } },
  ],
}

describe('PUT /api/v1/lists/:id/members/:userId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(adminAuth as any)
  })

  it('rejects an invalid role with 400', async () => {
    const res = await PUT(makeReq('PUT', { role: 'super' }), { params } as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when list does not exist', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(null as any)
    const res = await PUT(makeReq('PUT', { role: 'admin' }), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not admin/owner', async () => {
    mockAuth.mockResolvedValue(memberAuth as any)
    mockPrisma.taskList.findUnique.mockResolvedValue(listWithAdminAndMember as any)
    const res = await PUT(makeReq('PUT', { role: 'admin' }), { params } as any)
    expect(res.status).toBe(403)
  })

  it('refuses to change the owner role', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(listWithAdminAndMember as any)
    const res = await PUT(makeReq('PUT', { role: 'member' }), { params: paramsRemoveOwner } as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when user is not a member', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue({
      ...listWithAdminAndMember,
      listMembers: [listWithAdminAndMember.listMembers[0]],
    } as any)
    const res = await PUT(makeReq('PUT', { role: 'admin' }), { params } as any)
    expect(res.status).toBe(404)
  })

  it('updates role for an admin caller', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(listWithAdminAndMember as any)
    ;(mockPrisma.listMember.update as any).mockResolvedValue({})

    const res = await PUT(makeReq('PUT', { role: 'admin' }), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.member.isAdmin).toBe(true)
    expect(mockPrisma.listMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { listId_userId: { listId: 'list-1', userId: 'member-1' } },
        data: { role: 'admin' },
      })
    )
  })
})

describe('DELETE /api/v1/lists/:id/members/:userId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 404 when list does not exist', async () => {
    mockAuth.mockResolvedValue(adminAuth as any)
    mockPrisma.taskList.findUnique.mockResolvedValue(null as any)
    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 403 when a non-admin tries to remove someone else', async () => {
    mockAuth.mockResolvedValue(memberAuth as any)
    mockPrisma.taskList.findUnique.mockResolvedValue(listWithAdminAndMember as any)
    const res = await DELETE(
      makeReq('DELETE'),
      { params: Promise.resolve({ id: 'list-1', userId: 'admin-1' }) } as any
    )
    expect(res.status).toBe(403)
  })

  it('refuses to remove the owner', async () => {
    mockAuth.mockResolvedValue(adminAuth as any)
    mockPrisma.taskList.findUnique.mockResolvedValue(listWithAdminAndMember as any)
    const res = await DELETE(makeReq('DELETE'), { params: paramsRemoveOwner } as any)
    expect(res.status).toBe(400)
  })

  it('lets a non-admin remove themselves', async () => {
    mockAuth.mockResolvedValue(memberAuth as any)
    mockPrisma.taskList.findUnique.mockResolvedValue(listWithAdminAndMember as any)
    ;(mockPrisma.listMember.delete as any).mockResolvedValue({})

    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(200)
    expect(mockPrisma.listMember.delete).toHaveBeenCalledWith({
      where: { listId_userId: { listId: 'list-1', userId: 'member-1' } },
    })
  })

  it('lets an admin remove a member', async () => {
    mockAuth.mockResolvedValue(adminAuth as any)
    mockPrisma.taskList.findUnique.mockResolvedValue(listWithAdminAndMember as any)
    ;(mockPrisma.listMember.delete as any).mockResolvedValue({})

    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(200)
  })
})
