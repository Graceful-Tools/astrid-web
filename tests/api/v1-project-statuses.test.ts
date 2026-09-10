/**
 * /api/v1/projects/:id/statuses (AWTD-883)
 *
 * The board-status verbs had no versioned route: everything else the Windows
 * core speaks is `/api/v1/...`, but adding, renaming, reordering and removing a
 * column went through the unversioned `/api/statuses`, which took the board in
 * the request BODY. That one exception had to be carried as a special case in
 * the client.
 *
 * Two things these tests pin, because both are the kind of mistake that still
 * returns 200:
 *
 * - **The board comes from the PATH.** A `projectId` in the body is not a
 *   second opinion; it is ignored. Reading it would let a caller authorised for
 *   one board write a column onto another.
 * - **Rename and remove keep faith with `statusRole`.** Rename preserves the
 *   role (tasks point at their column by it), and remove clears the role on the
 *   tasks that were in the column, so they fall back to Inbox instead of
 *   matching no column at all.
 *
 * The service layer is real here — only Prisma, Redis and the auth middleware
 * are mocked — so these also prove the v1 route reaches the same
 * `lib/projects-service.ts` functions the unversioned route calls, rather than
 * reimplementing the rules beside them.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    project: { findUnique: vi.fn(), update: vi.fn() },
    task: { updateMany: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: { invalidate: { userListsAllVersions: vi.fn() } },
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

import { POST, PATCH, PUT, DELETE } from '@/app/api/v1/projects/[id]/statuses/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)

const OWNER = 'user-owner'
const BOARD = 'project-1'

const ctx = { params: Promise.resolve({ id: BOARD }) }

const req = (method: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/v1/projects/${BOARD}/statuses`, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

/** A board with one custom column already on it. */
const blocked = { role: 'custom-blocked', name: 'Blocked', order: 0 }
const shipped = { role: 'custom-shipped', name: 'Shipped', order: 1 }

/** The customStates the board answers with, plus its owner for the guard read. */
function boardIs(customStates: unknown, ownerId = OWNER, lists: { id: string }[] = [{ id: 'list-1' }]) {
  mockPrisma.project.findUnique.mockImplementation(async ({ select }: never) => {
    const record: Record<string, unknown> = {}
    if ((select as Record<string, unknown>)?.ownerId) record.ownerId = ownerId
    if ((select as Record<string, unknown>)?.customStates) record.customStates = customStates
    if ((select as Record<string, unknown>)?.lists) record.lists = lists
    return record
  })
}

/** The customStates the route wrote, whichever verb wrote them. */
function writtenStates() {
  const call = mockPrisma.project.update.mock.calls.at(-1)?.[0] as { data: { customStates: unknown } }
  return call.data.customStates as { role: string; name: string; order: number }[]
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: OWNER, source: 'oauth', scopes: ['*'], clientId: 'c1' } as never)
  mockPrisma.project.update.mockResolvedValue({} as never)
  mockPrisma.task.updateMany.mockResolvedValue({ count: 0 } as never)
  boardIs([])
})

describe('POST /api/v1/projects/:id/statuses (AWTD-883)', () => {
  it('adds a custom column and answers the v1 envelope', async () => {
    const response = await POST(req('POST', { name: 'Blocked' }), ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.state).toMatchObject({ role: 'custom-blocked', name: 'Blocked' })
    expect(body.meta).toMatchObject({ apiVersion: 'v1', authSource: 'oauth' })
    expect(writtenStates()).toHaveLength(1)
  })

  it('rejects a name that clashes with a built-in column', async () => {
    const response = await POST(req('POST', { name: 'Ready' }), ctx)

    expect(response.status).toBe(400)
    expect(mockPrisma.project.update).not.toHaveBeenCalled()
  })

  it('reports a duplicate name as a conflict, not a bad request', async () => {
    boardIs([blocked])

    const response = await POST(req('POST', { name: 'blocked' }), ctx)

    expect(response.status).toBe(409)
  })

  it('takes the board from the path, never from the body', async () => {
    // A body projectId naming another board is not a second opinion. Honouring
    // it would let a caller authorised for this board write onto that one.
    await POST(req('POST', { name: 'Blocked', projectId: 'someone-elses-board' }), ctx)

    for (const [args] of mockPrisma.project.findUnique.mock.calls) {
      expect((args as { where: { id: string } }).where.id).toBe(BOARD)
    }
    const updated = mockPrisma.project.update.mock.calls.at(-1)?.[0] as { where: { id: string } }
    expect(updated.where.id).toBe(BOARD)
  })

  it('is 403 for someone who does not own the board', async () => {
    boardIs([], 'someone-else')

    const response = await POST(req('POST', { name: 'Blocked' }), ctx)

    expect(response.status).toBe(403)
    expect(mockPrisma.project.update).not.toHaveBeenCalled()
  })

  it('is 404 when the board does not exist', async () => {
    mockPrisma.project.findUnique.mockResolvedValue(null as never)

    const response = await POST(req('POST', { name: 'Blocked' }), ctx)

    expect(response.status).toBe(404)
  })
})

describe('PATCH /api/v1/projects/:id/statuses (AWTD-883)', () => {
  it('renames a custom column and keeps its role', async () => {
    boardIs([blocked])

    const response = await PATCH(req('PATCH', { role: 'custom-blocked', name: 'On hold' }), ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    // The role is what every task in the column points at — a rename that
    // minted a new one would orphan all of them.
    expect(body.state).toMatchObject({ role: 'custom-blocked', name: 'On hold' })
  })

  it('renames a built-in column as a per-board override', async () => {
    const response = await PATCH(req('PATCH', { role: 'ready', name: 'Up next' }), ctx)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.state).toMatchObject({ role: 'ready', name: 'Up next' })
  })

  it('is 404 for a role that is not on this board', async () => {
    const response = await PATCH(req('PATCH', { role: 'custom-nope', name: 'Whatever' }), ctx)

    expect(response.status).toBe(404)
  })

  it('is 400 when no role is named', async () => {
    const response = await PATCH(req('PATCH', { name: 'On hold' }), ctx)

    expect(response.status).toBe(400)
  })
})

describe('PUT /api/v1/projects/:id/statuses (AWTD-883)', () => {
  it('moves a custom column one slot up', async () => {
    boardIs([blocked, shipped])

    const response = await PUT(req('PUT', { role: 'custom-shipped', direction: 'up' }), ctx)

    expect(response.status).toBe(200)
    const order = writtenStates()
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(s => s.role)
    expect(order).toEqual(['custom-shipped', 'custom-blocked'])
  })

  it('is 400 for a direction that is neither up nor down', async () => {
    boardIs([blocked, shipped])

    const response = await PUT(req('PUT', { role: 'custom-shipped', direction: 'sideways' }), ctx)

    expect(response.status).toBe(400)
    expect(mockPrisma.project.update).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/projects/:id/statuses (AWTD-883)', () => {
  it('removes the column and clears statusRole on the tasks that were in it', async () => {
    boardIs([blocked], OWNER, [{ id: 'list-1' }, { id: 'list-2' }])

    const response = await DELETE(req('DELETE', { role: 'custom-blocked' }), ctx)

    expect(response.status).toBe(200)
    // Without this the tasks stay on the board matching no column: present in
    // the list view, invisible on the board.
    expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
      where: { listId: { in: ['list-1', 'list-2'] }, statusRole: 'custom-blocked' },
      data: { statusRole: null },
    })
    expect(writtenStates()).toEqual([])
  })

  it('refuses to remove a built-in column', async () => {
    const response = await DELETE(req('DELETE', { role: 'ready' }), ctx)

    expect(response.status).toBe(400)
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled()
  })

  it('is 403 for someone who does not own the board', async () => {
    boardIs([blocked], 'someone-else')

    const response = await DELETE(req('DELETE', { role: 'custom-blocked' }), ctx)

    expect(response.status).toBe(403)
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled()
  })
})
