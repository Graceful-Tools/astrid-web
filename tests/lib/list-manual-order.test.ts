/**
 * Task 7883f710 — `POST /api/v1/lists/:id/manual-order`, filed from the Windows
 * client, which refuses unversioned paths and so could not reach the legacy
 * route.
 *
 * The rule now lives in lib/list-manual-order.ts and both routes call it. The
 * two parts worth pinning down are the two things `PUT /api/v1/lists/:id`
 * (which also accepts `manualSortOrder`) does NOT do:
 *
 *   - the order is reconciled against the tasks actually in the list, so it
 *     cannot drift from the list's contents;
 *   - every member is told, so other open clients redraw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn(), update: vi.fn() },
    task: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: { invalidate: { userListsAllVersions: vi.fn() } },
}))

const broadcastToUsers = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers }))

import { setListManualOrder, sanitizeManualOrder } from '@/lib/list-manual-order'
import { prisma } from '@/lib/prisma'
import { RedisCache } from '@/lib/redis'

const mockPrisma = vi.mocked(prisma, true)
const mockRedis = vi.mocked(RedisCache, true)

const OWNER = 'owner-1'
const MEMBER = 'member-1'

const LIST = {
  id: 'list-1',
  ownerId: OWNER,
  isVirtual: false,
  privacy: 'PRIVATE',
  publicListType: null,
  listMembers: [{ userId: MEMBER, role: 'member' }],
}

/** The tasks in the list, oldest first — the order the service falls back to. */
function tasksInList(ids: string[]) {
  mockPrisma.task.findMany.mockResolvedValue(ids.map(id => ({ id })) as never)
}

/** The order actually written to the database. */
function writtenOrder(): string[] {
  return mockPrisma.taskList.update.mock.calls[0][0].data.manualSortOrder as string[]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.taskList.findUnique.mockResolvedValue({ ...LIST } as never)
  tasksInList(['t1', 't2', 't3'])
  mockPrisma.taskList.update.mockImplementation((async (args: {
    data: { manualSortOrder: string[] }
  }) => ({
    ...LIST,
    manualSortOrder: args.data.manualSortOrder,
    owner: { id: OWNER, name: 'Owner', email: 'owner@example.com', image: null },
    listMembers: LIST.listMembers,
  })) as never)
  mockRedis.invalidate.userListsAllVersions.mockResolvedValue(undefined as never)
  broadcastToUsers.mockResolvedValue(undefined)
})

describe('sanitizeManualOrder (task 7883f710)', () => {
  it('keeps the requested order when it names exactly the list', () => {
    expect(sanitizeManualOrder(['t3', 't1', 't2'], ['t1', 't2', 't3'])).toEqual(['t3', 't1', 't2'])
  })

  it('drops ids for tasks that are no longer in the list', () => {
    // The task left the list while the drag was in flight. Keeping it would
    // persist an id nothing can render.
    expect(sanitizeManualOrder(['t1', 'gone', 't2'], ['t1', 't2'])).toEqual(['t1', 't2'])
  })

  it('appends tasks the caller did not mention, in creation order', () => {
    // A task added by someone else since the client last loaded. Left out, it
    // would have no position at all.
    expect(sanitizeManualOrder(['t3'], ['t1', 't2', 't3'])).toEqual(['t3', 't1', 't2'])
  })

  it('collapses duplicates to the first mention', () => {
    expect(sanitizeManualOrder(['t2', 't1', 't2'], ['t1', 't2'])).toEqual(['t2', 't1'])
  })

  it('ignores non-string entries rather than storing them', () => {
    expect(sanitizeManualOrder([null, 't1', 7, { id: 't2' }], ['t1', 't2'])).toEqual(['t1', 't2'])
  })

  it('falls back to creation order for an empty request', () => {
    expect(sanitizeManualOrder([], ['t1', 't2'])).toEqual(['t1', 't2'])
  })
})

describe('setListManualOrder (task 7883f710)', () => {
  it('saves the sanitized order, not the order it was handed', async () => {
    const result = await setListManualOrder({
      listId: 'list-1',
      userId: OWNER,
      order: ['t3', 'stale-id', 't3'],
    })

    expect(result).toMatchObject({ ok: true, order: ['t3', 't1', 't2'] })
    expect(writtenOrder()).toEqual(['t3', 't1', 't2'])
  })

  it('tells every member, so other open clients redraw', async () => {
    await setListManualOrder({ listId: 'list-1', userId: OWNER, order: ['t2'] })

    expect(broadcastToUsers).toHaveBeenCalledTimes(1)
    const [recipients, payload] = broadcastToUsers.mock.calls[0]
    expect(recipients).toEqual(expect.arrayContaining([OWNER, MEMBER]))
    expect(payload.type).toBe('list_updated')
  })

  it('does not broadcast this caller’s favorite flags to everyone', async () => {
    mockPrisma.taskList.update.mockResolvedValue({
      ...LIST,
      isFavorite: true,
      favoriteOrder: 3,
      owner: { id: OWNER, name: 'Owner', email: 'owner@example.com', image: null },
    } as never)

    await setListManualOrder({ listId: 'list-1', userId: OWNER, order: ['t1'] })

    const [, payload] = broadcastToUsers.mock.calls[0]
    expect(payload.data).not.toHaveProperty('isFavorite')
    expect(payload.data).not.toHaveProperty('favoriteOrder')
  })

  it('invalidates the lists cache for every member', async () => {
    await setListManualOrder({ listId: 'list-1', userId: OWNER, order: ['t1'] })

    expect(mockRedis.invalidate.userListsAllVersions).toHaveBeenCalledWith(OWNER)
    expect(mockRedis.invalidate.userListsAllVersions).toHaveBeenCalledWith(MEMBER)
  })

  it('still succeeds when the broadcast fails', async () => {
    broadcastToUsers.mockRejectedValue(new Error('sse down'))

    const result = await setListManualOrder({ listId: 'list-1', userId: OWNER, order: ['t1'] })

    // The order is saved. A late redraw elsewhere is not a failed reorder.
    expect(result).toMatchObject({ ok: true })
  })

  it('lets a plain member reorder', async () => {
    const result = await setListManualOrder({ listId: 'list-1', userId: MEMBER, order: ['t2'] })

    expect(result).toMatchObject({ ok: true })
  })

  it('400s a payload whose order is not an array, before any read', async () => {
    const result = await setListManualOrder({
      listId: 'list-1',
      userId: OWNER,
      order: undefined,
    })

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(mockPrisma.taskList.findUnique).not.toHaveBeenCalled()
  })

  it('404s a list that does not exist', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(null as never)

    const result = await setListManualOrder({ listId: 'nope', userId: OWNER, order: [] })

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('400s a virtual list, which has no order of its own to save', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue({ ...LIST, isVirtual: true } as never)

    const result = await setListManualOrder({ listId: 'list-1', userId: OWNER, order: [] })

    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('403s someone with no role on a private list', async () => {
    const result = await setListManualOrder({
      listId: 'list-1',
      userId: 'stranger-1',
      order: ['t1'],
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('403s a stranger on a PUBLIC copy-only list', async () => {
    // The legacy route granted access to any authenticated caller whenever
    // privacy was PUBLIC, so a passer-by could rewrite the owner's arrangement.
    // canUserEditTasks applies the policy this repo already chose for editing
    // tasks on a copy-only list: members only.
    mockPrisma.taskList.findUnique.mockResolvedValue({
      ...LIST,
      privacy: 'PUBLIC',
      publicListType: 'copy_only',
    } as never)

    const result = await setListManualOrder({
      listId: 'list-1',
      userId: 'passer-by',
      order: ['t1'],
    })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('lets a viewer reorder a PUBLIC collaborative list', async () => {
    // The other half of that same policy: a collaborative public list is meant
    // to be edited by whoever shows up.
    mockPrisma.taskList.findUnique.mockResolvedValue({
      ...LIST,
      privacy: 'PUBLIC',
      publicListType: 'collaborative',
    } as never)

    const result = await setListManualOrder({
      listId: 'list-1',
      userId: 'passer-by',
      order: ['t1'],
    })

    expect(result).toMatchObject({ ok: true })
  })
})
