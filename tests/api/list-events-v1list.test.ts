/**
 * AWTD-1046 — list and membership live events carry the full v1 list.
 *
 * The list half of AWTD-1040. These events carried a partial list (a raw
 * Prisma row, or only ids and a name), so astrid-core (iOS, Mac, Windows)
 * followed each one with GET /api/v1/lists/:id. They now also carry exactly
 * that response as `v1List`, and its presence is the signal the client may
 * skip the fetch.
 *
 * The GET body is per viewer — favorites and sort/filter preferences are the
 * caller's own — so each recipient's `v1List` must equal what THAT recipient's
 * GET returns, not the actor's. Someone who cannot see the list (a member just
 * removed) gets the lean event and never the roster.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const OWNER = 'owner-1'
const MEMBER = 'member-1'
const NEWCOMER = 'new-1'

const user = (id: string) => ({ id, name: id, email: `${id}@example.com`, image: null, isAIAgent: false, aiAgentType: null })

// The database, as far as these tests need one. Every read below answers from
// it, so the GET and the event loader cannot be fed different data.
const db = vi.hoisted(() => ({
  list: null as any,
  favorites: [] as Array<{ userId: string; listId: string; favoriteOrder: number | null }>,
  preferences: [] as Array<Record<string, unknown> & { userId: string; listId: string }>,
}))

function listRow() {
  return JSON.parse(JSON.stringify(db.list), (key, value) =>
    key === 'createdAt' || key === 'updatedAt' ? new Date(value) : value
  )
}

vi.mock('@/lib/prisma', () => {
  const inUsers = (where: any, row: { userId: string }) =>
    where.userId?.in ? where.userId.in.includes(row.userId) : row.userId === where.userId
  return {
    prisma: {
      taskList: {
        findUnique: vi.fn(async () => listRow()),
        findFirst: vi.fn(async ({ where }: any) => {
          const list = listRow()
          const visible = list.privacy === 'PUBLIC' || list.ownerId === where.OR?.[0]?.ownerId ||
            list.listMembers.some((m: any) => m.userId === where.OR?.[1]?.listMembers?.some?.userId)
          return visible ? list : null
        }),
        update: vi.fn(async () => listRow()),
      },
      task: { findMany: vi.fn(async () => []) },
      user: { findMany: vi.fn(async () => []), findUnique: vi.fn(async () => null) },
      listMember: {
        create: vi.fn(async ({ data }: any) => {
          db.list.listMembers.push({ id: `lm-${data.userId}`, listId: data.listId, userId: data.userId, role: data.role, user: user(data.userId) })
          return data
        }),
        deleteMany: vi.fn(async ({ where }: any) => {
          const before = db.list.listMembers.length
          db.list.listMembers = db.list.listMembers.filter((m: any) => m.userId !== where.userId)
          return { count: before - db.list.listMembers.length }
        }),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      userListFavorite: {
        findUnique: vi.fn(async ({ where }: any) =>
          db.favorites.find(f => f.userId === where.userId_listId.userId && f.listId === where.userId_listId.listId) ?? null),
        findMany: vi.fn(async ({ where }: any) => db.favorites.filter(f => inUsers(where, f) && (!where.listId || f.listId === where.listId))),
      },
      userListViewPreference: {
        findUnique: vi.fn(async ({ where }: any) =>
          db.preferences.find(p => p.userId === where.userId_listId.userId && p.listId === where.userId_listId.listId) ?? null),
        findMany: vi.fn(async ({ where }: any) => db.preferences.filter(p => inUsers(where, p))),
      },
    },
  }
})

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    del: vi.fn(),
    delPattern: vi.fn(async () => undefined),
    invalidate: { userListsAllVersions: vi.fn(async () => undefined) },
    keys: { userLists: (id: string) => `lists:${id}` },
  },
}))

vi.mock('@/lib/list-member-operations', () => ({
  invalidateMemberCache: vi.fn(async () => undefined),
  invalidateMemberCaches: vi.fn(async () => undefined),
}))

const broadcastToUsers = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))

import { authenticateAPI } from '@/lib/api-auth-middleware'
import { addListMember, removeListMember, changeListMemberRole } from '@/services/list-member.service'
import { setListManualOrder } from '@/lib/list-manual-order'

const json = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

async function getV1ListAs(userId: string) {
  vi.mocked(authenticateAPI).mockResolvedValue({
    userId, source: 'oauth', scopes: ['lists:read'], isAIAgent: false,
    user: { id: userId, email: `${userId}@example.com`, name: userId, isAIAgent: false },
  } as any)
  const { GET } = await import('@/app/api/v1/lists/[id]/route')
  const res = await GET(new NextRequest('http://localhost/api/v1/lists/list-1'), {
    params: Promise.resolve({ id: 'list-1' }),
  })
  return json((await res.json()).list)
}

/** The event of `type` that reached `userId`, or undefined. */
function eventFor(type: string, userId: string) {
  const call = broadcastToUsers.mock.calls.find(
    ([recipients, event]: any) => event.type === type && recipients.includes(userId)
  ) as any
  return call?.[1]
}

// As the member routes pass it: with the owner relation, which is how the
// audience finds the owner.
const memberContext = () => ({
  id: 'list-1',
  name: 'Work',
  color: '#3b82f6',
  ownerId: OWNER,
  owner: user(OWNER),
  isVirtual: false,
  listMembers: db.list.listMembers.map((m: any) => ({ userId: m.userId })),
})

beforeEach(() => {
  vi.clearAllMocks()
  db.list = {
    id: 'list-1',
    name: 'Work',
    description: null,
    color: '#3b82f6',
    imageUrl: null,
    privacy: 'SHARED',
    ownerId: OWNER,
    owner: user(OWNER),
    listMembers: [{ id: 'lm-1', listId: 'list-1', userId: MEMBER, role: 'member', user: user(MEMBER) }],
    listInvites: [],
    _count: { tasks: 3 },
    isVirtual: false,
    virtualListType: null,
    sortBy: 'manual',
    manualSortOrder: ['t1', 't2'],
    filterPriority: null,
    filterAssignee: null,
    filterDueDate: null,
    filterCompletion: null,
    filterRepeating: null,
    filterAssignedBy: null,
    filterInLists: null,
    defaultPriority: 0,
    defaultRepeating: null,
    defaultAssigneeId: null,
    aiAgentsEnabled: null,
    publicListType: null,
    defaultIsPrivate: false,
    defaultDueDate: null,
    defaultDueTime: '09:00',
    githubRepositoryId: null,
    preferredAiProvider: null,
    projectId: null,
    listType: 'regular',
    recentlyCompletedWindow: null,
    showSubtasks: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-29T00:00:00.000Z',
  }
  // Different per-user state for the owner and the member, so an event that
  // sends one person's view to everyone cannot pass.
  db.favorites = [{ userId: OWNER, listId: 'list-1', favoriteOrder: 2 }]
  db.preferences = [{ userId: MEMBER, listId: 'list-1', sortBy: 'priority', filterPriority: '3' }]
})

describe('AWTD-1046 — list events carry the full v1 list as v1List', () => {
  it('AWTD-1046: list_member_added gives each viewer exactly their own GET /api/v1/lists/:id', async () => {
    await addListMember({ list: memberContext(), member: user(NEWCOMER), role: 'member', actor: { id: OWNER, name: 'Owner' } })

    for (const viewer of [OWNER, MEMBER, NEWCOMER]) {
      const event = eventFor('list_member_added', viewer)
      expect(event, viewer).toBeDefined()
      // The lean fields every client reads today are unchanged.
      expect(event.data).toMatchObject({ listId: 'list-1', newMemberId: NEWCOMER })
      expect(json(event.data.v1List), viewer).toEqual(await getV1ListAs(viewer))
    }
    // The per-viewer part is really per viewer.
    expect(eventFor('list_member_added', OWNER).data.v1List.isFavorite).toBe(true)
    expect(eventFor('list_member_added', MEMBER).data.v1List.isFavorite).toBe(false)
    expect(eventFor('list_member_added', MEMBER).data.v1List.sortBy).toBe('priority')
  })

  it('AWTD-1046: a removed member gets the lean list_member_removed, the rest get v1List', async () => {
    await removeListMember({ list: memberContext(), member: user(MEMBER), actor: { id: OWNER, name: 'Owner' } })

    const toRemoved = eventFor('list_member_removed', MEMBER)
    expect(toRemoved).toBeDefined()
    expect(toRemoved.data.removedMemberId).toBe(MEMBER)
    expect(toRemoved.data.v1List).toBeUndefined()

    const toOwner = eventFor('list_member_removed', OWNER)
    expect(json(toOwner.data.v1List)).toEqual(await getV1ListAs(OWNER))
    expect(toOwner.data.v1List.listMembers).toEqual([])
  })

  it('AWTD-1046: a role change carries v1List', async () => {
    await changeListMemberRole({ list: memberContext(), member: user(MEMBER), role: 'admin', actor: { id: OWNER } })

    const event = eventFor('list_admin_role_granted', MEMBER)
    expect(json(event.data.v1List)).toEqual(await getV1ListAs(MEMBER))
  })

  it('AWTD-1046: list_updated from a manual reorder carries each viewer’s v1List', async () => {
    await setListManualOrder({ listId: 'list-1', userId: OWNER, order: [] })

    for (const viewer of [OWNER, MEMBER]) {
      const event = eventFor('list_updated', viewer)
      expect(event, viewer).toBeDefined()
      expect(json(event.data.v1List), viewer).toEqual(await getV1ListAs(viewer))
    }
  })

  it('AWTD-1046: GET /api/v1/lists/:id returns defaultDueTime, as its PUT always did', async () => {
    expect((await getV1ListAs(OWNER)).defaultDueTime).toBe('09:00')
  })
})
