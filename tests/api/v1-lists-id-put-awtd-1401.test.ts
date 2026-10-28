/**
 * RED for AWTD-1401.
 *
 * Every web list save goes through PUT /api/v1/lists/:id, and the legacy
 * PUT /api/lists/:id it replaced did four things v1 never learned:
 *
 * 1. a list going PUBLIC unassigns its tasks (AWTD-1109), through the task
 *    service so agents, reminders and caches follow;
 * 2. a default assignee must be someone on the list;
 * 3. listType changes are limited to regular ⇄ label;
 * 4. the other members are told with a `list_updated` SSE.
 *
 * The web client PUTs its WHOLE TaskList object on every save, so the guards
 * act only on a field that changes: an unchanged stale value must not turn an
 * unrelated rename into a 400.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const updateTaskWithSideEffects = vi.hoisted(() =>
  vi.fn(async (args: { taskId: string }) => ({ ok: true, task: { id: args.taskId }, rolledForward: false })),
)
const broadcastListEvent = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/services/task.service', () => ({ updateTaskWithSideEffects }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    project: { findMany: vi.fn(async () => []) },
    user: { findMany: vi.fn(async () => []) },
    listViewPreference: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []), upsert: vi.fn() },
    task: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: { invalidate: { userLists: vi.fn(), userListsAllVersions: vi.fn(async () => {}) } },
}))

vi.mock('@/lib/images/update-list-image', () => ({
  ListImageClaimError: class extends Error {},
  updateListWithImageOwnership: vi.fn(async ({ update }: { update: (c: unknown) => unknown }) =>
    update((await import('@/lib/prisma')).prisma)),
  deleteListWithImageRelease: vi.fn(),
}))
vi.mock('@/lib/default-assignee', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveDefaultAssignees: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/backends/list-wire', () => ({ loadListBackendInfo: vi.fn(async () => new Map()) }))
vi.mock('@/lib/lists/v1-list-shape', () => ({
  V1_LIST_READ_INCLUDE: {},
  shapeV1List: (l: unknown) => l,
  broadcastListEvent,
}))
vi.mock('@/lib/favorites', () => ({ hydrateSingleListFavorite: vi.fn(), toggleFavorite: vi.fn() }))
vi.mock('@/lib/analytics-events', () => ({ trackEventFromRequest: vi.fn(), AnalyticsEventType: {} }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

import { PUT } from '@/app/api/v1/lists/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma, true)

const listRow = {
  id: 'l1',
  ownerId: 'owner',
  name: 'Groceries',
  privacy: 'SHARED',
  listType: 'regular',
  projectId: null,
  imageUrl: null,
  aiAgentsEnabled: null,
  defaultAssigneeId: null as string | null,
  listMembers: [
    { userId: 'member', role: 'member' },
    { userId: 'admin', role: 'admin' },
  ],
}

const ctx = { params: Promise.resolve({ id: 'l1' }) }

function put(body: unknown) {
  return PUT(
    new NextRequest('http://localhost/api/v1/lists/l1', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
    ctx as never,
  )
}

function existing(overrides: Partial<typeof listRow>) {
  const row = { ...listRow, ...overrides }
  mockPrisma.taskList.findFirst.mockResolvedValue(row as never)
  return row
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAPI).mockResolvedValue({ userId: 'owner', source: 'session', scopes: ['*'], clientId: null } as never)
  existing({})
  mockPrisma.taskList.update.mockImplementation((async (args: { data: Record<string, unknown> }) =>
    ({ ...listRow, ...args.data })) as never)
  mockPrisma.task.findMany.mockResolvedValue([{ id: 'task-a' }, { id: 'task-b' }] as never)
})

describe('a list going public unassigns its tasks (AWTD-1401, AWTD-1109)', () => {
  it('unassigns each assigned task through updateTaskWithSideEffects, never a raw updateMany', async () => {
    const res = await put({ ...listRow, privacy: 'PUBLIC' })

    expect(res.status).toBe(200)
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled()
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lists: { some: { id: 'l1' } }, assigneeId: { not: null } } }),
    )
    const calls = updateTaskWithSideEffects.mock.calls.map(([args]) => args)
    expect(calls.map(c => c.taskId).sort()).toEqual(['task-a', 'task-b'])
    for (const call of calls) expect(call).toMatchObject({ actorId: 'owner', intent: { assigneeId: null } })
  })

  it('one task failing to unassign does not fail the list save', async () => {
    updateTaskWithSideEffects.mockImplementationOnce(async () => { throw new Error('boom') })

    const res = await put({ privacy: 'PUBLIC' })

    expect(res.status).toBe(200)
    expect(updateTaskWithSideEffects).toHaveBeenCalledTimes(2)
  })

  it('a list that was already public unassigns nothing on a later save', async () => {
    existing({ privacy: 'PUBLIC' })

    const res = await put({ ...listRow, privacy: 'PUBLIC', name: 'Renamed' })

    expect(res.status).toBe(200)
    expect(updateTaskWithSideEffects).not.toHaveBeenCalled()
  })
})

describe('the default assignee must be on the list (AWTD-1401)', () => {
  it('rejects a user who is not a member', async () => {
    const res = await put({ defaultAssigneeId: 'stranger' })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('member of the list')
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it.each([['member'], ['admin'], ['owner'], ['unassigned'], [null]])('accepts %s', async value => {
    const res = await put({ defaultAssigneeId: value })

    expect(res.status).toBe(200)
  })

  it('a whole-list save carrying an UNCHANGED stale assignee is not rejected', async () => {
    existing({ defaultAssigneeId: 'former-member' })

    const res = await put({ ...listRow, defaultAssigneeId: 'former-member', name: 'Renamed' })

    expect(res.status).toBe(200)
  })
})

describe('listType changes are limited to regular ⇄ label (AWTD-1401)', () => {
  it('rejects turning a regular list into a status column', async () => {
    const res = await put({ listType: 'status' })

    expect(res.status).toBe(400)
    expect(mockPrisma.taskList.update).not.toHaveBeenCalled()
  })

  it('allows regular → label', async () => {
    const res = await put({ listType: 'label' })

    expect(res.status).toBe(200)
  })

  it('a whole-list save of a status list carrying its own listType is not rejected', async () => {
    existing({ listType: 'status' })

    const res = await put({ ...listRow, listType: 'status', name: 'Doing' })

    expect(res.status).toBe(200)
  })
})

describe('other members hear about the change (AWTD-1401)', () => {
  it('broadcasts list_updated to the owner and members, not the actor', async () => {
    vi.mocked(authenticateAPI).mockResolvedValue({ userId: 'admin', source: 'session', scopes: ['*'], clientId: null } as never)

    const res = await put({ name: 'Shopping' })

    expect(res.status).toBe(200)
    expect(broadcastListEvent).toHaveBeenCalledTimes(1)
    const [args] = broadcastListEvent.mock.calls[0] as unknown as [{ listId: string; type: string; recipients: string[] }]
    expect(args.listId).toBe('l1')
    expect(args.type).toBe('list_updated')
    expect(new Set(args.recipients)).toEqual(new Set(['owner', 'member']))
  })

  it("a change to the caller's own view only broadcasts nothing", async () => {
    const res = await put({ sortBy: 'priority' })

    expect(res.status).toBe(200)
    expect(broadcastListEvent).not.toHaveBeenCalled()
  })

  it('a failed broadcast does not fail the save', async () => {
    broadcastListEvent.mockRejectedValueOnce(new Error('sse down'))

    const res = await put({ name: 'Shopping' })

    expect(res.status).toBe(200)
  })
})
