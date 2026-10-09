/**
 * AWTD-1035 — completing a repeating task outside the web never counted the
 * occurrence, so "end after N times" never ended.
 *
 * The web completes with `completed: true` and the server rolls the task
 * forward, incrementing `occurrenceCount` itself. iOS, the Mac and astrid-core
 * (so Windows) roll on the device and send the new due date with
 * `completed: false`, so the server's roll never runs for them — and this route
 * did not read `occurrenceCount` from the body, so the count never moved.
 *
 * The fix is the smaller of the two the task offered: accept the client's
 * count. Every client computes it the same way, through astrid-core's
 * `repeating::completion`.
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
  requireTaskAccess: vi.fn().mockResolvedValue(undefined),
  requireTaskReadAccess: vi.fn().mockResolvedValue(undefined),
}))

const TASK = {
  id: 'task-1',
  creatorId: 'user-1',
  completed: false,
  repeating: 'daily',
  occurrenceCount: 2,
  dueDateTime: new Date('2026-09-28T09:00:00Z'),
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

async function send(body: unknown) {
  const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
  const res = await PUT(put(body), ctx)
  const call = taskUpdate.mock.calls[0]
  return { status: res.status, data: call ? call[0].data : undefined }
}

beforeEach(() => {
  vi.clearAllMocks()
  taskFindUnique.mockResolvedValue(TASK)
  taskUpdate.mockResolvedValue({ ...TASK, comments: [] })
})

// Same warm-up as v1-task-update-clearing (task aca946b8): keep the module
// graph's import cost out of the first test's timeout.
beforeAll(async () => {
  await import('@/app/api/v1/tasks/[id]/route')
})

describe('PUT /api/v1/tasks/:id writes occurrenceCount (AWTD-1035)', () => {
  it('writes the count a client sends with its device-side roll-forward', async () => {
    const { status, data } = await send({
      dueDateTime: '2026-09-29T09:00:00Z',
      completed: false,
      occurrenceCount: 3,
    })

    expect(status).toBe(200)
    expect(data.occurrenceCount).toBe(3)
  })

  it('accepts zero, which is a real count after a series is reset', async () => {
    expect((await send({ occurrenceCount: 0 })).data.occurrenceCount).toBe(0)
  })

  it('leaves the count alone when the client does not send it', async () => {
    // Older clients never send it. Absent must mean "untouched", not 0 —
    // otherwise every edit from them would reset the series.
    const { data } = await send({ title: 'renamed' })
    expect(data).not.toHaveProperty('occurrenceCount')
  })

  it.each([
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['a string', '3'],
    ['null', null],
  ])('rejects %s with a 400 rather than handing it to the Int column', async (_label, value) => {
    const { status } = await send({ occurrenceCount: value })

    expect(status).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })
})
