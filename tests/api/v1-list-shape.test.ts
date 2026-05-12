/**
 * Asserts /api/v1/lists and /api/v1/lists/:id include the project-board
 * fields (`projectId`, `listType`, `statusRole`, `statusOrder`,
 * `statusDescription`, `statusCompleted`, `recentlyCompletedWindow`)
 * for iOS to render boards and the per-list Recently-completed window.
 *
 * v1-contract.test.ts pins the V1List *type* shape; this pins the
 * *route output* shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    listMember: { findFirst: vi.fn() },
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
  hydrateListFavorites: vi.fn(),
  hydrateSingleListFavorite: vi.fn(async (list: any) => {
    list.isFavorite = false
    list.favoriteOrder = null
  }),
  toggleFavorite: vi.fn(),
}))

vi.mock('@/lib/task-count-utils', () => ({
  getTaskCountInclude: vi.fn(() => ({ _count: { select: { tasks: true } } })),
  getMultipleListTaskCounts: vi.fn(async () => ({})),
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    getOrSet: vi.fn(async (_k: string, fn: () => Promise<unknown>) => fn()),
    invalidate: { userLists: vi.fn() },
    keys: {
      userListsV1: (id: string) => `lists:user:${id}:v1`,
      userLists: (id: string) => `lists:user:${id}`,
    },
  },
}))

vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { LIST_EDITED: 'LIST_EDITED', LIST_DELETED: 'LIST_DELETED', LIST_ADDED: 'LIST_ADDED' },
  trackEventFromRequest: vi.fn(),
}))

import { GET as listLists } from '@/app/api/v1/lists/route'
import { GET as getList } from '@/app/api/v1/lists/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const auth = {
  userId: 'u1',
  source: 'oauth' as const,
  scopes: ['lists:read', 'lists:write'],
  isAIAgent: false,
  user: { id: 'u1', email: 'u@x', name: 'U', isAIAgent: false },
}

const statusList = {
  id: 'status-ready',
  name: 'Ready',
  description: 'Time to get to work!',
  color: '#3b82f6',
  imageUrl: null,
  privacy: 'SHARED',
  ownerId: 'u1',
  owner: null,
  listMembers: [],
  listInvites: [],
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
  githubRepositoryId: null,
  preferredAiProvider: null,
  projectId: 'proj-1',
  listType: 'status',
  statusRole: 'ready',
  statusOrder: 1,
  statusDescription: 'Time to get to work!',
  statusCompleted: false,
  recentlyCompletedWindow: { kind: 'duration', amount: 7, unit: 'day' },
  createdAt: new Date('2026-05-11T00:00:00Z'),
  updatedAt: new Date('2026-05-11T00:00:00Z'),
  _count: { tasks: 0 },
}

const BOARD_FIELDS = [
  'projectId',
  'listType',
  'statusRole',
  'statusOrder',
  'statusDescription',
  'statusCompleted',
  'recentlyCompletedWindow',
] as const

describe('GET /api/v1/lists — board fields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(auth as any)
  })

  it('emits all board-related fields for status lists', async () => {
    ;(mockPrisma.taskList.findMany as any).mockResolvedValue([statusList])

    const res = await listLists(
      new NextRequest('http://localhost/api/v1/lists'),
      undefined as any,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    const list = json.lists[0]
    for (const field of BOARD_FIELDS) {
      expect(list, `missing field ${field}`).toHaveProperty(field)
    }
    expect(list.projectId).toBe('proj-1')
    expect(list.listType).toBe('status')
    expect(list.statusRole).toBe('ready')
    expect(list.statusOrder).toBe(1)
    expect(list.statusDescription).toBe('Time to get to work!')
    expect(list.statusCompleted).toBe(false)
    expect(list.recentlyCompletedWindow).toEqual({ kind: 'duration', amount: 7, unit: 'day' })
  })

  it('emits null/defaults for legacy lists with no project attached', async () => {
    const legacyList = {
      ...statusList,
      id: 'legacy',
      projectId: null,
      listType: 'regular',
      statusRole: null,
      statusOrder: null,
      statusDescription: null,
      statusCompleted: false,
      recentlyCompletedWindow: null,
    }
    ;(mockPrisma.taskList.findMany as any).mockResolvedValue([legacyList])

    const res = await listLists(
      new NextRequest('http://localhost/api/v1/lists'),
      undefined as any,
    )
    const json = await res.json()
    const list = json.lists[0]
    expect(list.projectId).toBeNull()
    expect(list.listType).toBe('regular')
    expect(list.statusRole).toBeNull()
    expect(list.statusOrder).toBeNull()
    expect(list.statusDescription).toBeNull()
    expect(list.statusCompleted).toBe(false)
    expect(list.recentlyCompletedWindow).toBeNull()
  })
})

describe('GET /api/v1/lists/:id — board fields', () => {
  const params = Promise.resolve({ id: 'status-ready' })

  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(auth as any)
  })

  it('emits all board-related fields for the single list', async () => {
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(statusList)

    const res = await getList(
      new NextRequest('http://localhost/api/v1/lists/status-ready'),
      { params } as any,
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    for (const field of BOARD_FIELDS) {
      expect(json.list, `missing field ${field}`).toHaveProperty(field)
    }
    expect(json.list.projectId).toBe('proj-1')
    expect(json.list.listType).toBe('status')
    expect(json.list.recentlyCompletedWindow).toEqual({
      kind: 'duration', amount: 7, unit: 'day',
    })
  })
})
