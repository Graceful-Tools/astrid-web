/**
 * /api/v1/lists must carry the fields the web reads (task dc143ab2, 641a7615 step 3).
 *
 * Legacy `GET /api/lists` returns raw Prisma rows — every column — enriched
 * with a resolved `defaultAssignee`. v1 returns an explicit projection, and
 * three things the web reads are simply absent from it. Pointing the 42 client
 * call sites at v1 today would switch features off with no error anywhere:
 *
 *   defaultAssignee   24 reads — assignee name/avatar render blank
 *   aiAgentsEnabled   15 reads — undefined is falsy, so AI affordances vanish
 *   publicListType    14 reads — a real column legacy returns
 *
 * `_count.tasks` is deliberately NOT added. v1 renamed it to `taskCount`, that
 * rename is a better name, and the web absorbs it — a projection should not
 * carry both spellings of the same number.
 *
 * This is the third gap of this exact shape under 641a7615 (after
 * subtaskDisplay and secureFiles). Every v1 route written as a projection
 * rather than a passthrough has quietly dropped something a client reads, so
 * these are pinned rather than fixed and forgotten.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    task: { groupBy: vi.fn(), findMany: vi.fn() },
  },
}))

// getOrSet must run the producer, not serve a cache: the whole point is what
// the projection builds.
vi.mock('@/lib/redis', () => ({
  RedisCache: {
    keys: { userListsV1: (id: string) => `lists:v1:${id}` },
    getOrSet: vi.fn(async (_key: string, producer: () => Promise<unknown>) => producer()),
    invalidate: { userLists: vi.fn() },
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

import { GET } from '@/app/api/v1/lists/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const listRow = {
  id: 'l1',
  name: 'Groceries',
  ownerId: 'u1',
  privacy: 'PRIVATE',
  color: '#fff',
  isFavorite: false,
  favoriteOrder: null,
  owner: { id: 'u1', name: 'Jon', email: 'j@example.com', image: null },
  listMembers: [],
  listInvites: [],
  defaultAssigneeId: 'u2',
  aiAgentsEnabled: { enabledTypes: ['claude'], defaultAgentId: 'agent-1' },
  publicListType: 'copy',
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

async function firstList() {
  const response = await GET(new NextRequest('http://localhost/api/v1/lists'))
  const body = await response.json()
  return body.lists?.[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.taskList.findMany.mockResolvedValue([listRow] as never)
  mockPrisma.task.groupBy.mockResolvedValue([] as never)
  mockPrisma.task.findMany.mockResolvedValue([] as never)
  mockPrisma.user.findMany.mockResolvedValue(
    [{ id: 'u2', name: 'Sam', email: 's@example.com', image: null }] as never
  )
})

describe('GET /api/v1/lists field parity (task dc143ab2)', () => {
  it('resolves defaultAssignee, not just the id', async () => {
    // 24 call sites render the assignee's name or avatar. The id alone leaves
    // all of them blank, with nothing to indicate a missing field.
    const list = await firstList()

    expect(list.defaultAssignee).toMatchObject({ id: 'u2', name: 'Sam' })
  })

  it('leaves defaultAssignee null when the list has none', async () => {
    mockPrisma.taskList.findMany.mockResolvedValue(
      [{ ...listRow, defaultAssigneeId: null }] as never
    )

    const list = await firstList()

    expect(list.defaultAssignee).toBeNull()
  })

  it('treats the "unassigned" sentinel as no assignee', async () => {
    // Legacy special-cases this string; without it the lookup misses and the
    // sentinel leaks to the client as a broken user reference.
    mockPrisma.taskList.findMany.mockResolvedValue(
      [{ ...listRow, defaultAssigneeId: 'unassigned' }] as never
    )

    const list = await firstList()

    expect(list.defaultAssignee).toBeNull()
  })

  it('carries aiAgentsEnabled', async () => {
    // undefined is falsy, so a missing field does not error — the AI agent
    // affordances just quietly stop rendering.
    const list = await firstList()

    expect(list.aiAgentsEnabled).toEqual({ enabledTypes: ['claude'], defaultAgentId: 'agent-1' })
  })

  it('carries publicListType', async () => {
    const list = await firstList()

    expect(list.publicListType).toBe('copy')
  })

  it('still exposes the task count under its v1 name only', async () => {
    // Deliberate: v1 renamed _count.tasks to taskCount and the web absorbs the
    // rename. A projection carrying both spellings of one number invites them
    // to disagree.
    const list = await firstList()

    expect(list).toHaveProperty('taskCount')
    expect(list._count).toBeUndefined()
  })
})
