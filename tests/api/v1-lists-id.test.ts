import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    listMember: {
      findFirst: vi.fn(),
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

vi.mock('@/lib/favorites', () => ({
  hydrateSingleListFavorite: vi.fn(async (list: any) => {
    list.isFavorite = false
    list.favoriteOrder = null
  }),
  toggleFavorite: vi.fn(),
}))

vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { LIST_EDITED: 'LIST_EDITED', LIST_DELETED: 'LIST_DELETED' },
  trackEventFromRequest: vi.fn(),
}))

import { GET, PUT, DELETE } from '@/app/api/v1/lists/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { toggleFavorite } from '@/lib/favorites'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)
const mockToggleFavorite = vi.mocked(toggleFavorite)

const ownerAuth = {
  userId: 'owner-1',
  source: 'oauth' as const,
  scopes: ['lists:read', 'lists:write'],
  isAIAgent: false,
  user: { id: 'owner-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

const memberAuth = {
  ...ownerAuth,
  userId: 'member-1',
  user: { ...ownerAuth.user, id: 'member-1' },
}

function makeReq(method: 'GET' | 'PUT' | 'DELETE', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/lists/list-1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const params = Promise.resolve({ id: 'list-1' })

const baseList = {
  id: 'list-1',
  name: 'My List',
  description: '',
  color: '#3b82f6',
  imageUrl: null,
  privacy: 'PRIVATE',
  ownerId: 'owner-1',
  isVirtual: false,
  virtualListType: null,
  sortBy: null,
  manualSortOrder: null,
  filterPriority: null,
  filterAssignee: null,
  filterDueDate: null,
  filterCompletion: null,
  filterRepeating: null,
  filterAssignedBy: null,
  filterInLists: null,
  defaultPriority: null,
  defaultRepeating: null,
  defaultAssigneeId: null,
  defaultIsPrivate: null,
  defaultDueDate: null,
  defaultDueTime: null,
  githubRepositoryId: null,
  preferredAiProvider: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  owner: { id: 'owner-1', name: 'Jon', email: 'jon@example.com', image: null },
  listMembers: [],
  listInvites: [],
  _count: { tasks: 5 },
}

describe('GET /api/v1/lists/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ownerAuth as any)
  })

  it('returns 404 when caller has no access', async () => {
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(null)
    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns the list when caller is owner', async () => {
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(baseList)
    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.list.id).toBe('list-1')
    expect(json.list.taskCount).toBe(5)
  })
})

describe('PUT /api/v1/lists/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ownerAuth as any)
    ;(mockPrisma.taskList.update as any).mockResolvedValue(baseList)
    ;(mockPrisma.listMember.findFirst as any).mockResolvedValue(null)
  })

  it('returns 404 when list not found / no permission', async () => {
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(null)
    const res = await PUT(makeReq('PUT', { name: 'Renamed' }), { params } as any)
    expect(res.status).toBe(404)
  })

  it('owner can update content fields', async () => {
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(baseList)
    const res = await PUT(makeReq('PUT', { name: 'Renamed', description: 'New' }), { params } as any)
    expect(res.status).toBe(200)
    const updateCall = (mockPrisma.taskList.update as any).mock.calls[0][0]
    expect(updateCall.data).toMatchObject({ name: 'Renamed', description: 'New' })
  })

  it('non-admin member cannot update content fields, but filter fields go through', async () => {
    mockAuth.mockResolvedValue(memberAuth as any)
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue({ ...baseList, ownerId: 'someone-else' })
    ;(mockPrisma.listMember.findFirst as any).mockResolvedValue(null) // not admin

    const res = await PUT(
      makeReq('PUT', { name: 'sneaky', sortBy: 'priority' }),
      { params } as any
    )
    expect(res.status).toBe(200)
    const updateCall = (mockPrisma.taskList.update as any).mock.calls[0][0]
    expect(updateCall.data.name).toBeUndefined()
    expect(updateCall.data.sortBy).toBe('priority')
  })

  it('isFavorite goes through toggleFavorite, not the TaskList row', async () => {
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(baseList)
    await PUT(makeReq('PUT', { isFavorite: true }), { params } as any)
    expect(mockToggleFavorite).toHaveBeenCalledWith('owner-1', 'list-1', true)
    const updateCall = (mockPrisma.taskList.update as any).mock.calls[0][0]
    expect(updateCall.data.isFavorite).toBeUndefined()
  })

  it('filter-only update widens the permission query to any member', async () => {
    mockAuth.mockResolvedValue(memberAuth as any)
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue({ ...baseList, ownerId: 'someone-else' })

    await PUT(makeReq('PUT', { sortBy: 'manual' }), { params } as any)

    const findCall = (mockPrisma.taskList.findFirst as any).mock.calls[0][0]
    // filter-only path uses no role restriction in the OR
    expect(findCall.where.OR).toEqual(
      expect.arrayContaining([
        { ownerId: 'member-1' },
        { listMembers: { some: { userId: 'member-1' } } },
      ])
    )
  })
})

describe('DELETE /api/v1/lists/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ownerAuth as any)
  })

  it('returns 404 when caller is not the owner', async () => {
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(null)
    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(404)
    expect(mockPrisma.taskList.delete).not.toHaveBeenCalled()
  })

  it('deletes when caller is the owner', async () => {
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(baseList)
    ;(mockPrisma.taskList.delete as any).mockResolvedValue({})
    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(200)
    expect(mockPrisma.taskList.delete).toHaveBeenCalledWith({ where: { id: 'list-1' } })
  })
})
