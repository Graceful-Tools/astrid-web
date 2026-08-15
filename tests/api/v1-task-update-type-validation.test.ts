/**
 * ORIGINAL HEADER (harness reused verbatim below) — Task 1e53501f — mobile clears fields with `''`, not `null`, and the route
 * must keep accepting both.
 *
 * iOS cannot send null on these: `UpdateTaskRequest.encode(to:)` is
 * `encodeIfPresent`, so a nil optional is OMITTED, which is how the client says
 * "leave unchanged". Clearing is expressed as an empty string.
 *
 * NOTHING IS BROKEN TODAY. This exists so it stays that way. The contract file
 * is what people tighten routes against, and a reader who takes the
 * empty-string case for sloppiness would break clearing on iOS silently — no
 * error, the write simply does nothing, and it looks like a client bug.
 *
 * The `assigneeId` case is the one to watch. Unlike the other two it is not an
 * explicit `=== ''`; it works only because `body.assigneeId || null` treats an
 * empty string as falsy. Rewriting that to `??` is a natural-looking
 * modernisation that keeps null working and breaks the only form iOS can send.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'user-1', scopes: ['tasks:write'], source: 'oauth' }, ctx),
}))

const taskUpdate = vi.hoisted(() => vi.fn())
const taskFindUnique = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: taskFindUnique, update: taskUpdate, findFirst: vi.fn() },
    taskList: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn() },
  },
}))

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/api-auth-middleware', () => ({
  getDeprecationWarning: () => null,
  // Throws on denial; resolving means access granted. These cases are about
  // the clearing semantics, not authorization, which has its own tests.
  requireTaskAccess: vi.fn().mockResolvedValue(undefined),
  requireTaskReadAccess: vi.fn().mockResolvedValue(undefined),
}))

const TASK = {
  id: 'task-1',
  creatorId: 'user-1',
  assigneeId: 'someone',
  parentTaskId: 'parent-1',
  dueDateTime: new Date(),
  lists: [{ id: 'list-1', ownerId: 'user-1', listMembers: [], privacy: 'PRIVATE' }],
}

function put(body: unknown) {
  return new NextRequest('http://localhost/api/v1/tasks/task-1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: 'task-1' }) } as never

/** The `data` object handed to prisma.task.update for this request. */
async function updateDataFor(body: unknown) {
  const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
  await PUT(put(body), ctx)
  const call = taskUpdate.mock.calls[0]
  return call ? call[0].data : undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  taskFindUnique.mockResolvedValue(TASK)
  taskUpdate.mockResolvedValue({ ...TASK, lists: TASK.lists, comments: [] })
})

/**
 * Task 87e19910 — a wrong-typed scalar must be a 400, not a 500.
 *
 * PUT /api/v1/tasks/:id builds `const data: any = {}` and copies request
 * fields straight in with only an `!== undefined` check. Nothing asserts the
 * VALUE's type, so a client sending priority: "high" hands Prisma a string for
 * an Int column. Prisma rejects it, the route has no catch for that, and the
 * caller gets a 500 for what is plainly a bad request.
 *
 * Same shape as the four enum bugs already fixed under this task (list
 * privacy, comment type, two chat routes) — the difference is that these
 * columns are scalars rather than Postgres enums, so the failure is a driver
 * validation error instead of an invalid-enum-value error. Identical from the
 * caller's side: a 500 where they deserved a 400.
 *
 * dueDateTime is the subtle one. It is not copied directly — it goes through
 * `new Date(...)`, and `new Date('garbage')` is an Invalid Date rather than a
 * throw. That reaches Prisma too.
 */
describe('PUT /api/v1/tasks/:id rejects wrong-typed scalars (task 87e19910)', () => {
  async function statusFor(body: unknown) {
    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const res = await PUT(put(body), ctx)
    return res.status
  }

  it('400s on a non-numeric priority instead of handing Prisma a string', async () => {
    expect(await statusFor({ priority: 'high' })).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('400s on a non-boolean completed', async () => {
    expect(await statusFor({ completed: 'yes' })).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('400s on a non-string title rather than writing a number into a String column', async () => {
    expect(await statusFor({ title: 123 })).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('400s on an unparseable dueDateTime rather than storing an Invalid Date', async () => {
    // new Date('garbage') does not throw — it yields Invalid Date, which is
    // why this one survives a naive try/catch and reaches the driver.
    expect(await statusFor({ dueDateTime: 'garbage' })).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('still accepts the correct types', async () => {
    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const res = await PUT(put({ priority: 2, completed: true, title: 'ok' }), ctx)
    expect(res.status).toBe(200)
    expect(taskUpdate).toHaveBeenCalled()
  })

  it('leaves the empty-string clearing contract intact', async () => {
    // Guarding types must not break the iOS clearing convention (task 1e53501f):
    // '' is a legitimate value for these, not a type error.
    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    expect((await PUT(put({ dueDateTime: '' }), ctx)).status).toBe(200)
    expect((await PUT(put({ assigneeId: '' }), ctx)).status).toBe(200)
  })
})
