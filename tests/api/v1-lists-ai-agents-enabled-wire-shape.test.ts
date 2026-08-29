/**
 * `aiAgentsEnabled` on the v1 wire is a `string[]` — always.
 *
 * The API contract has said so since the field existed
 * (lib/api/api-contract.ts: `aiAgentsEnabled: { type: 'array' }`), and iOS/Mac
 * decode it as `[String]?` with a synthesized Codable. But PUT /api/v1/lists/:id
 * normalizes every write into `{ enabledTypes, defaultAgentId }` and the three
 * v1 list projections passed that stored object straight through. The first
 * time one list in an account got its default agent saved from the web, every
 * shipped iOS and Mac client failed to decode the WHOLE `/api/v1/lists`
 * response — one dictionary at `lists[10].aiAgentsEnabled` and the app fell
 * back to "offline mode" with 0 lists:
 *
 *   ⚠️ [SyncManager] Full sync failed (offline mode): decodingError(
 *     typeMismatch: expected Array<Any>. Path: lists[10].aiAgentsEnabled.
 *     Expected to decode Array<Any> but found a dictionary instead.)
 *
 * Fixed on the server rather than the clients because the clients in the
 * field cannot be updated; the object form was never a deliberate contract
 * change. The extra `defaultAgentId` the web needs rides in a NEW sibling,
 * `aiAgentConfig`, which old clients ignore.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    taskList: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn() },
    task: { groupBy: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    listActivity: { create: vi.fn() },
    activityLog: { create: vi.fn() },
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    keys: { userListsV1: (id: string) => `lists:v1:${id}`, userLists: (id: string) => `lists:${id}` },
    getOrSet: vi.fn(async (_key: string, producer: () => Promise<unknown>) => producer()),
    invalidate: { userLists: vi.fn() },
    del: vi.fn(),
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

vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { LIST_EDITED: 'LIST_EDITED', LIST_DELETED: 'LIST_DELETED' },
  trackEventFromRequest: vi.fn(),
}))

import { GET as getLists } from '@/app/api/v1/lists/route'
import { GET as getList, PUT as putList } from '@/app/api/v1/lists/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

/** A row exactly as the PUT normalizer stores it — the shape that broke iOS. */
const OBJECT_FORM = { enabledTypes: ['claude', 'coding'], defaultAgentId: 'agent-1' }

const listRow = {
  id: 'l1',
  name: 'Web To-do',
  ownerId: 'u1',
  privacy: 'PRIVATE',
  color: '#fff',
  isFavorite: false,
  favoriteOrder: null,
  owner: { id: 'u1', name: 'Jon', email: 'j@example.com', image: null },
  listMembers: [],
  listInvites: [],
  defaultAssigneeId: null,
  aiAgentsEnabled: OBJECT_FORM,
  projectId: null,
  _count: { tasks: 0 },
  createdAt: new Date(0),
  updatedAt: new Date(0),
}

const ctx = { params: Promise.resolve({ id: 'l1' }) }

async function putBody(body: Record<string, unknown>) {
  const response = await putList(
    new NextRequest('http://localhost/api/v1/lists/l1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    ctx as never
  )
  return {
    status: response.status,
    list: (await response.json()).list,
    stored: (mockPrisma.taskList.update.mock.calls[0]?.[0] as never as {
      data: Record<string, unknown>
    })?.data,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(mockPrisma.$transaction as any).mockImplementation((operation: any) => operation(mockPrisma))
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.taskList.findMany.mockResolvedValue([listRow] as never)
  mockPrisma.taskList.findFirst.mockResolvedValue(listRow as never)
  mockPrisma.taskList.findUnique.mockResolvedValue(listRow as never)
  mockPrisma.taskList.update.mockResolvedValue(listRow as never)
  mockPrisma.task.groupBy.mockResolvedValue([] as never)
  mockPrisma.task.findMany.mockResolvedValue([] as never)
  mockPrisma.task.count.mockResolvedValue(0 as never)
  mockPrisma.user.findMany.mockResolvedValue([] as never)
})

describe('v1 lists: aiAgentsEnabled is an array on the wire (iOS/Mac decode failure)', () => {
  it('GET /api/v1/lists emits the stored object form as string[] plus aiAgentConfig', async () => {
    const response = await getLists(new NextRequest('http://localhost/api/v1/lists'))
    const { lists } = await response.json()

    expect(lists[0].aiAgentsEnabled).toEqual(['claude', 'coding'])
    expect(lists[0].aiAgentConfig).toEqual(OBJECT_FORM)
  })

  it('GET /api/v1/lists emits [] — not null, not a dictionary — for a list with no config', async () => {
    mockPrisma.taskList.findMany.mockResolvedValue([{ ...listRow, aiAgentsEnabled: null }] as never)

    const response = await getLists(new NextRequest('http://localhost/api/v1/lists'))
    const { lists } = await response.json()

    expect(lists[0].aiAgentsEnabled).toEqual([])
    expect(lists[0].aiAgentConfig).toEqual({ enabledTypes: [], defaultAgentId: null })
  })

  it('GET /api/v1/lists/:id emits the same pair', async () => {
    const response = await getList(new NextRequest('http://localhost/api/v1/lists/l1'), ctx as never)
    const { list } = await response.json()

    expect(list.aiAgentsEnabled).toEqual(['claude', 'coding'])
    expect(list.aiAgentConfig).toEqual(OBJECT_FORM)
  })

  it('PUT /api/v1/lists/:id echoes the same pair back', async () => {
    const { status, list } = await putBody({ name: 'Renamed' })

    expect(status).toBe(200)
    expect(list.aiAgentsEnabled).toEqual(['claude', 'coding'])
    expect(list.aiAgentConfig).toEqual(OBJECT_FORM)
  })

  it('PUT honours aiAgentConfig when the web sends it (it carries defaultAgentId)', async () => {
    const { stored } = await putBody({
      aiAgentsEnabled: ['claude'],
      aiAgentConfig: { enabledTypes: ['claude'], defaultAgentId: 'agent-2' },
    })

    expect(stored?.aiAgentsEnabled).toEqual({ enabledTypes: ['claude'], defaultAgentId: 'agent-2' })
  })

  it('PUT with only the legacy string[] keeps the default agent an old client cannot express', async () => {
    // A Mac client saving list settings round-trips the whole list with
    // `aiAgentsEnabled: [...]` and no `aiAgentConfig`. It has no field for
    // the default agent, so that write must not wipe the one chosen on web.
    const { stored } = await putBody({ aiAgentsEnabled: ['coding'] })

    expect(stored?.aiAgentsEnabled).toEqual({ enabledTypes: ['coding'], defaultAgentId: 'agent-1' })
  })

  it('PUT with aiAgentConfig: null clears the default agent', async () => {
    const { stored } = await putBody({ aiAgentConfig: null })

    expect(stored?.aiAgentsEnabled).toEqual({ enabledTypes: [], defaultAgentId: null })
  })
})
