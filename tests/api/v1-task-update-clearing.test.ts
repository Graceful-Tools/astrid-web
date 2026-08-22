/**
 * Task 1e53501f — mobile clears fields with `''`, not `null`, and the route
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

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
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
 * Warm the route module before the timed tests (task aca946b8).
 *
 * Every test here does `await import('@/app/api/v1/tasks/[id]/route')` in its body, so the FIRST one paid
 * the transform-and-import cost of that whole module graph inside its 5000ms
 * budget. Alone that is fine; under the full suite it competes with every other
 * worker for CPU and the first test times out. That is exactly what was
 * observed — the failing test was always the first in the file, isolation
 * always passed, and a re-run on the same commit passed with the transform
 * cache warm.
 *
 * Importing here moves the cost out of the assertion window (and a hook gets
 * the 10s budget rather than a test's 5s). The `await import` calls inside the
 * tests then hit the module cache and are free.
 */
beforeAll(async () => {
  await import('@/app/api/v1/tasks/[id]/route')
})

describe('PUT /api/v1/tasks/:id accepts empty string as a clear (task 1e53501f)', () => {
  it('clears dueDateTime on empty string, and drops the all-day flag with it', async () => {
    const data = await updateDataFor({ dueDateTime: '' })

    expect(data.dueDateTime).toBeNull()
    // An all-day flag on no date is meaningless, so clearing must reset it.
    expect(data.isAllDay).toBe(false)
  })

  it('clears dueDateTime on null too', async () => {
    expect((await updateDataFor({ dueDateTime: null })).dueDateTime).toBeNull()
  })

  it('unassigns on empty string — the assigneeId case that is only incidental', async () => {
    // `body.assigneeId || null`. Changing that `||` to `??` keeps this test's
    // null sibling passing and breaks this one, which is the whole point.
    expect((await updateDataFor({ assigneeId: '' })).assigneeId).toBeNull()
  })

  it('unassigns on null', async () => {
    expect((await updateDataFor({ assigneeId: null })).assigneeId).toBeNull()
  })

  it('promotes a subtask to top-level on empty string', async () => {
    expect((await updateDataFor({ parentTaskId: '' })).parentTaskId).toBeNull()
  })

  it('promotes a subtask to top-level on null', async () => {
    expect((await updateDataFor({ parentTaskId: null })).parentTaskId).toBeNull()
  })

  it('leaves a field alone when it is absent, rather than clearing it', async () => {
    // The other half of the convention: omitted means "do not touch". If this
    // ever broke, every partial update would wipe the fields it did not send.
    const data = await updateDataFor({ title: 'renamed' })

    expect(data).not.toHaveProperty('dueDateTime')
    expect(data).not.toHaveProperty('assigneeId')
    expect(data).not.toHaveProperty('parentTaskId')
  })
})
