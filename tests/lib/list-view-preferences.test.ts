/**
 * Task aa4e7eb0 — sort and filters are per-principal, not per-list.
 *
 * They were columns on the shared `TaskList` row, so changing a filter on a
 * shared list changed it for every member. Jon, 2026-09-13: "THERE SHOULD BE
 * NO SHARED SAVED FILTERS. only AI AGENTS and HUMANS."
 *
 * Keyed on `userId`, which is what that means: an AI agent is a `User` row, so
 * an agent's saved filter is its own exactly like a person's, through one
 * mechanism rather than a special case per kind of principal.
 *
 * The case that matters most is the last one here: two principals, one list,
 * each seeing their own filters. That is the bug, stated as a test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    userListViewPreference: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: { invalidate: { userListsAllVersions: vi.fn() } },
}))

import {
  LIST_VIEW_PREFERENCE_FIELDS,
  hydrateListViewPreferences,
  hydrateSingleListViewPreferences,
  saveListViewPreferences,
  splitListViewPreferences,
} from '@/lib/list-view-preferences'
import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'

const mockPrisma = vi.mocked(prisma, true)
const mockRedis = vi.mocked(RedisCache, true)

const HUMAN = 'user-1'
const AGENT = 'ai-agent-claude'

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.userListViewPreference.findMany.mockResolvedValue([] as never)
  mockPrisma.userListViewPreference.findUnique.mockResolvedValue(null as never)
  mockPrisma.userListViewPreference.upsert.mockResolvedValue({} as never)
  mockRedis.invalidate.userListsAllVersions.mockResolvedValue(undefined as never)
})

describe('splitListViewPreferences (task aa4e7eb0)', () => {
  it('routes sort and filters to the viewer, and everything else to the list', () => {
    const { viewPreferences, rest } = splitListViewPreferences({
      name: 'Work',
      sortBy: 'priority',
      filterCompletion: 'hide',
      privacy: 'PRIVATE',
    })

    expect(viewPreferences).toEqual({ sortBy: 'priority', filterCompletion: 'hide' })
    expect(rest).toEqual({ name: 'Work', privacy: 'PRIVATE' })
  })

  it('leaves manualSortOrder with the LIST, not the viewer', () => {
    // The hand-arranged order is shared — people arrange a shared list
    // together. Only the decision to sort by it is personal.
    const { viewPreferences, rest } = splitListViewPreferences({
      manualSortOrder: ['t1', 't2'],
      sortBy: 'manual',
    })

    expect(viewPreferences).toEqual({ sortBy: 'manual' })
    expect(rest).toEqual({ manualSortOrder: ['t1', 't2'] })
  })

  it('leaves isVirtual and virtualListType with the list', () => {
    // They say what kind of thing the list is, not how you are looking at it.
    const { viewPreferences, rest } = splitListViewPreferences({
      isVirtual: true,
      virtualListType: 'today',
    })

    expect(viewPreferences).toEqual({})
    expect(rest).toEqual({ isVirtual: true, virtualListType: 'today' })
  })

  it('returns only the keys actually present', () => {
    // Clients round-trip whole list objects. Treating an absent key as "clear
    // it" would have one client's save wipe a filter it never knew about.
    const { viewPreferences } = splitListViewPreferences({ sortBy: 'dueDate' })

    expect(Object.keys(viewPreferences)).toEqual(['sortBy'])
  })

  it('keeps an explicit null, which means the user cleared that filter', () => {
    const { viewPreferences } = splitListViewPreferences({ filterAssignee: null })

    expect(viewPreferences).toEqual({ filterAssignee: null })
  })

  it('covers every field the schema calls a view preference', () => {
    const body = Object.fromEntries(LIST_VIEW_PREFERENCE_FIELDS.map(f => [f, 'x']))

    const { viewPreferences, rest } = splitListViewPreferences(body)

    expect(Object.keys(viewPreferences).sort()).toEqual([...LIST_VIEW_PREFERENCE_FIELDS].sort())
    expect(rest).toEqual({})
  })
})

describe('saveListViewPreferences (task aa4e7eb0)', () => {
  it('upserts on (userId, listId)', async () => {
    await saveListViewPreferences({
      userId: HUMAN,
      listId: 'list-1',
      preferences: { sortBy: 'priority' },
    })

    expect(mockPrisma.userListViewPreference.upsert).toHaveBeenCalledWith({
      where: { userId_listId: { userId: HUMAN, listId: 'list-1' } },
      create: { userId: HUMAN, listId: 'list-1', sortBy: 'priority' },
      update: { sortBy: 'priority' },
    })
  })

  it('invalidates only this user’s cache, not every member’s', async () => {
    // The shared columns forced a fan-out: your filter change had to invalidate
    // everyone, because it changed what everyone saw. It no longer does.
    await saveListViewPreferences({
      userId: HUMAN,
      listId: 'list-1',
      preferences: { sortBy: 'priority' },
    })

    expect(mockRedis.invalidate.userListsAllVersions).toHaveBeenCalledTimes(1)
    expect(mockRedis.invalidate.userListsAllVersions).toHaveBeenCalledWith(HUMAN)
  })

  it('writes nothing when there is nothing to write', async () => {
    await saveListViewPreferences({ userId: HUMAN, listId: 'list-1', preferences: {} })

    expect(mockPrisma.userListViewPreference.upsert).not.toHaveBeenCalled()
  })

  it('still succeeds when cache invalidation fails', async () => {
    mockRedis.invalidate.userListsAllVersions.mockRejectedValue(new Error('redis down') as never)

    await expect(
      saveListViewPreferences({ userId: HUMAN, listId: 'list-1', preferences: { sortBy: 'a' } })
    ).resolves.toBeUndefined()
  })

  it('treats an AI agent as an ordinary principal', async () => {
    await saveListViewPreferences({
      userId: AGENT,
      listId: 'list-1',
      preferences: { filterCompletion: 'hide' },
    })

    expect(mockPrisma.userListViewPreference.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_listId: { userId: AGENT, listId: 'list-1' } },
      })
    )
  })
})

describe('hydrateListViewPreferences (task aa4e7eb0)', () => {
  it('overlays the viewer’s stored values onto the list', async () => {
    mockPrisma.userListViewPreference.findMany.mockResolvedValue([
      { listId: 'list-1', sortBy: 'priority', filterCompletion: 'hide' },
    ] as never)

    const lists = [{ id: 'list-1', sortBy: 'created', filterCompletion: 'show' }]
    await hydrateListViewPreferences(lists, HUMAN)

    expect(lists[0]).toMatchObject({ sortBy: 'priority', filterCompletion: 'hide' })
  })

  it('leaves the list’s own values in place for someone with no preference', async () => {
    // The shared columns are kept as the list's default view, which is what
    // makes this migration additive: an untouched list looks as it always did.
    const lists = [{ id: 'list-1', sortBy: 'created', filterCompletion: 'show' }]

    await hydrateListViewPreferences(lists, HUMAN)

    expect(lists[0]).toMatchObject({ sortBy: 'created', filterCompletion: 'show' })
  })

  it('honours a stored null as "this filter is cleared"', async () => {
    // Not the same as having no preference: the user turned the list's default
    // filter off, and that has to win over the shared column.
    mockPrisma.userListViewPreference.findMany.mockResolvedValue([
      { listId: 'list-1', sortBy: null, filterCompletion: null },
    ] as never)

    const lists = [{ id: 'list-1', sortBy: 'created', filterCompletion: 'show' }]
    await hydrateListViewPreferences(lists, HUMAN)

    expect(lists[0].sortBy).toBeNull()
    expect(lists[0].filterCompletion).toBeNull()
  })

  it('does not touch manualSortOrder', async () => {
    mockPrisma.userListViewPreference.findMany.mockResolvedValue([
      { listId: 'list-1', sortBy: 'manual' },
    ] as never)

    const lists = [
      { id: 'list-1', sortBy: 'created', manualSortOrder: ['t1', 't2'] } as Record<string, unknown> &
        { id: string },
    ]
    await hydrateListViewPreferences(lists, HUMAN)

    expect(lists[0].manualSortOrder).toEqual(['t1', 't2'])
    expect(lists[0].sortBy).toBe('manual')
  })

  it('reads in one query for many lists, and none for zero', async () => {
    await hydrateListViewPreferences([], HUMAN)
    expect(mockPrisma.userListViewPreference.findMany).not.toHaveBeenCalled()

    await hydrateListViewPreferences(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      HUMAN
    )
    expect(mockPrisma.userListViewPreference.findMany).toHaveBeenCalledTimes(1)
    expect(mockPrisma.userListViewPreference.findMany).toHaveBeenCalledWith({
      where: { userId: HUMAN, listId: { in: ['a', 'b', 'c'] } },
    })
  })

  it('hydrates a single list the same way', async () => {
    mockPrisma.userListViewPreference.findUnique.mockResolvedValue({
      listId: 'list-1',
      filterPriority: '3',
    } as never)

    const list = { id: 'list-1', filterPriority: '0' }
    await hydrateSingleListViewPreferences(list, HUMAN)

    expect(list.filterPriority).toBe('3')
  })

  it('THE BUG: two principals on one list each see their own filters', async () => {
    // A human and an AI agent share a list whose stored default hides nothing.
    // Before this change both read the same column, so whichever of them saved
    // last decided what the other saw.
    const shared = () => ({ id: 'list-1', sortBy: 'created', filterCompletion: 'show' })

    mockPrisma.userListViewPreference.findMany.mockImplementation((async (args: {
      where: { userId: string }
    }) =>
      args.where.userId === HUMAN
        ? [{ listId: 'list-1', sortBy: 'priority', filterCompletion: 'hide' }]
        : [{ listId: 'list-1', sortBy: 'dueDate', filterCompletion: 'show' }]) as never)

    const humanView = await hydrateListViewPreferences([shared()], HUMAN)
    const agentView = await hydrateListViewPreferences([shared()], AGENT)

    expect(humanView[0]).toMatchObject({ sortBy: 'priority', filterCompletion: 'hide' })
    expect(agentView[0]).toMatchObject({ sortBy: 'dueDate', filterCompletion: 'show' })
  })
})
