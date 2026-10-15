/**
 * AWTD-1256: `list.backend` on the v1 wire (spec §11.2).
 *
 * `supports` says what a list's backend can do; `backend` says what it IS. iOS
 * needs the second to switch its on-device GitHub Issues engine off for a
 * GitHub-backed list (AITD-491) — and shipped that gate on
 * `supports.repeatMode == 'spawn'` instead, which identifies such a list only
 * because lib/backends/supports.ts happens to derive every key from `backend`.
 *
 * Both read paths, because they are two projections: the collection route
 * builds its own, and `shapeV1List` serves `GET /lists/:id`, its PUT and the
 * live list events.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findMany: vi.fn(), findFirst: vi.fn() },
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
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
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

import { GET as listLists } from '@/app/api/v1/lists/route'
import { GET as getList } from '@/app/api/v1/lists/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { GITHUB_PROJECT_BACKEND } from '@/lib/backends/resolve'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)

const listRow = {
  id: 'l1',
  name: 'Board',
  description: '',
  color: '#fff',
  imageUrl: null,
  privacy: 'PRIVATE',
  ownerId: 'u1',
  owner: null,
  listMembers: [],
  listInvites: [],
  defaultAssigneeId: null,
  backend: null as string | null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  _count: { tasks: 0 },
}

async function collectionList(row: typeof listRow) {
  ;(mockPrisma.taskList.findMany as any).mockResolvedValue([row])
  const res = await listLists(new NextRequest('http://localhost/api/v1/lists'), undefined as any)
  return (await res.json()).lists[0]
}

async function singleList(row: typeof listRow) {
  ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(row)
  const res = await getList(
    new NextRequest('http://localhost/api/v1/lists/l1'),
    { params: Promise.resolve({ id: 'l1' }) } as any,
  )
  return (await res.json()).list
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'oauth', scopes: ['*'], clientId: null } as never)
})

describe.each([
  ['GET /api/v1/lists', collectionList],
  ['GET /api/v1/lists/:id', singleList],
])('%s carries list.backend (AWTD-1256)', (_route, read) => {
  it('is github_project on a GitHub-backed list', async () => {
    const list = await read({ ...listRow, backend: GITHUB_PROJECT_BACKEND })

    expect(list.backend).toBe('github_project')
  })

  it('is an explicit null on a classic list, not absent', async () => {
    // Absent would read as "an older server" to a client; null is the answer.
    const list = await read({ ...listRow, backend: null })

    expect(list).toHaveProperty('backend', null)
  })
})
