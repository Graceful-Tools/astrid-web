/**
 * RED for AWTD-1321.
 *
 * Project membership cascades to a project's lists, and the higher of the list
 * role and the project role wins (Jon, 2026-10-04). roleInList can only see
 * the project if the query loaded it — an absent `project` reads as "no
 * project role", so a project owner/admin who is not also a list member was
 * refused (and `listType` decides whether sibling-list access reaches a
 * board's status lists).
 *
 * Each entry point below loads a list and then gates on a list-permission
 * helper. This asserts the load asks for the project with the same shape as
 * PROJECT_ACCESS_INCLUDE — the invariant lib/task-query-utils.ts states for
 * every permission-bearing list query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PROJECT_ACCESS_INCLUDE } from '@/lib/list-permissions'

const findUnique = vi.hoisted(() => vi.fn(async () => null))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique, findFirst: findUnique },
    user: { findUnique: vi.fn(async () => null) },
    task: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/session-utils', () => ({
  getUnifiedSession: vi.fn(async () => ({ user: { id: 'caller', email: 'c@e.com' } })),
}))
vi.mock('@/lib/rate-limiter', async importOriginal => ({
  ...(await importOriginal<object>()),
  inviteRateLimiter: { checkRateLimitByKeyAsync: vi.fn(async () => ({ allowed: true, resetTime: 0 })) },
}))
vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(async () => ({ userId: 'caller', source: 'session', scopes: ['*'], clientId: null })),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) }) as never
const json = (url: string, method: string, body?: unknown) =>
  new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
  })

/** The `project` the query asked for, whether via include or select. */
function requestedProject() {
  const args = findUnique.mock.calls[0]?.[0] as { include?: { project?: unknown }; select?: { project?: unknown } }
  return args?.include?.project ?? args?.select?.project
}

beforeEach(() => vi.clearAllMocks())

const ENTRY_POINTS: Array<[string, () => Promise<unknown>]> = [
  ['setListManualOrder', async () => {
    const { setListManualOrder } = await import('@/lib/list-manual-order')
    await setListManualOrder({ listId: 'l1', userId: 'caller', order: [] })
  }],
  ['inviteToList', async () => {
    const { inviteToList } = await import('@/lib/list-invite')
    await inviteToList({
      listId: 'l1',
      inviter: { id: 'caller', email: 'c@e.com', name: 'C' } as never,
      email: 'x@e.com',
      role: 'member',
    } as never)
  }],
  ['POST /api/lists/:id/upload-image', async () => {
    const { POST } = await import('@/app/api/lists/[id]/upload-image/route')
    const form = new FormData()
    form.append('image', new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'a.png', { type: 'image/png' }))
    // Multipart parsing hangs under jsdom; the route only calls formData().
    await POST({ formData: async () => form } as never, params({ id: 'l1' }))
  }],
  ['POST /api/v1/lists/:id/copy', async () => {
    const { POST } = await import('@/app/api/v1/lists/[id]/copy/route')
    await POST(json('http://t/api/v1/lists/l1/copy', 'POST', {}), params({ id: 'l1' }))
  }],
  ['GET /api/v1/lists/:id/members', async () => {
    const { GET } = await import('@/app/api/v1/lists/[id]/members/route')
    await GET(json('http://t/api/v1/lists/l1/members', 'GET'), params({ id: 'l1' }))
  }],
  ['POST /api/v1/lists/:id/members', async () => {
    const { POST } = await import('@/app/api/v1/lists/[id]/members/route')
    await POST(json('http://t/api/v1/lists/l1/members', 'POST', { email: 'x@e.com', role: 'member' }), params({ id: 'l1' }))
  }],
  ['PUT /api/v1/lists/:id/members/:userId', async () => {
    const { PUT } = await import('@/app/api/v1/lists/[id]/members/[userId]/route')
    await PUT(json('http://t/api/v1/lists/l1/members/u2', 'PUT', { role: 'admin' }), params({ id: 'l1', userId: 'u2' }))
  }],
  ['DELETE /api/v1/lists/:id/members/:userId', async () => {
    const { DELETE } = await import('@/app/api/v1/lists/[id]/members/[userId]/route')
    await DELETE(json('http://t/api/v1/lists/l1/members/u2', 'DELETE'), params({ id: 'l1', userId: 'u2' }))
  }],
]

describe('permission-bearing list loads include the project (AWTD-1321)', () => {
  it.each(ENTRY_POINTS)('%s', async (_name, run) => {
    await run()
    expect(findUnique).toHaveBeenCalled()
    expect(requestedProject()).toEqual(PROJECT_ACCESS_INCLUDE.project)
  })

  it('setListManualOrder also loads listType (status-list inheritance)', async () => {
    const { setListManualOrder } = await import('@/lib/list-manual-order')
    await setListManualOrder({ listId: 'l1', userId: 'caller', order: [] })
    const args = findUnique.mock.calls[0]?.[0] as { select: Record<string, unknown> }
    expect(args.select.listType).toBe(true)
  })
})
