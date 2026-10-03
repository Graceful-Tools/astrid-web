/**
 * AWTD-1038 — `PUT /api/v1/tasks/:id` ignored `reminderTime`.
 *
 * The create route has always taken it; the update route dropped it on the
 * floor, so the response carried the OLD reminder time. A snooze made on a
 * device was therefore undone by the answer to its own edit: the client
 * applied the returned row and the reminder jumped back. astrid-core works
 * around it by preferring the time it sent over the one the server returns.
 *
 * Same PATCH semantics as every other field on this route: absent leaves it
 * alone, `null` or `''` clears it (iOS can only send `''` — see
 * v1-task-update-clearing.test.ts).
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
const reminderQueue = vi.hoisted(() => ({
  updateMany: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: taskFindUnique, update: taskUpdate, findFirst: vi.fn() },
    taskList: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn() },
    reminderQueue,
  },
}))

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/api-auth-middleware', () => ({
  getDeprecationWarning: () => null,
  requireTaskAccess: vi.fn().mockResolvedValue(undefined),
  requireTaskReadAccess: vi.fn().mockResolvedValue(undefined),
}))

const OLD_REMINDER = new Date('2030-01-01T09:00:00.000Z')
const SNOOZED = '2030-01-01T09:30:00.000Z'

const TASK = {
  id: 'task-1',
  title: 'Water the plants',
  creatorId: 'user-1',
  assigneeId: 'user-1',
  completed: false,
  dueDateTime: new Date('2030-01-01T10:00:00.000Z'),
  reminderTime: OLD_REMINDER,
  reminderType: 'push',
  reminderSent: true,
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
  return PUT(put(body), ctx)
}

/** The `data` object handed to prisma.task.update for this request. */
async function updateDataFor(body: unknown) {
  await send(body)
  const call = taskUpdate.mock.calls[0]
  return call ? call[0].data : undefined
}

beforeEach(() => {
  vi.clearAllMocks()
  taskFindUnique.mockResolvedValue(TASK)
  // Echo the write back, as the database would.
  taskUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    ...TASK,
    ...data,
    comments: [],
  }))
})

beforeAll(async () => {
  await import('@/app/api/v1/tasks/[id]/route')
})

describe('PUT /api/v1/tasks/:id — reminderTime (AWTD-1038)', () => {
  it('writes a new reminderTime, so a snooze is not undone by its own response', async () => {
    const data = await updateDataFor({ reminderTime: SNOOZED })

    expect(data.reminderTime).toEqual(new Date(SNOOZED))
    // A moved reminder has not fired yet, whatever the old one did.
    expect(data.reminderSent).toBe(false)
  })

  it('answers with the reminder time the edit asked for', async () => {
    const res = await send({ reminderTime: SNOOZED })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(new Date(body.task.reminderTime).toISOString()).toBe(SNOOZED)
  })

  it('clears the reminder on null and on empty string', async () => {
    expect((await updateDataFor({ reminderTime: null })).reminderTime).toBeNull()
    vi.clearAllMocks()
    taskFindUnique.mockResolvedValue(TASK)
    expect((await updateDataFor({ reminderTime: '' })).reminderTime).toBeNull()
  })

  it('leaves the reminder alone when the field is absent', async () => {
    const data = await updateDataFor({ title: 'Renamed' })
    expect(data).not.toHaveProperty('reminderTime')
    expect(data).not.toHaveProperty('reminderSent')
  })

  it('accepts reminderType alongside it', async () => {
    const data = await updateDataFor({ reminderTime: SNOOZED, reminderType: 'both' })
    expect(data.reminderType).toBe('both')
  })

  it('rejects an unparseable reminderTime with a 400, not a driver 500', async () => {
    const res = await send({ reminderTime: 'next tuesday-ish' })
    expect(res.status).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('rejects a wrong-typed reminderTime', async () => {
    const res = await send({ reminderTime: 42 })
    expect(res.status).toBe(400)
  })

  it('re-queues the explicit reminder at the new time', async () => {
    await send({ reminderTime: SNOOZED })

    // The old reminder is cancelled...
    expect(reminderQueue.updateMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1', status: 'pending' },
      data: { status: 'cancelled' },
    })
    // ...and only the snoozed one queued — not the due date's automatic set.
    const queued = reminderQueue.create.mock.calls.map(([{ data }]) => data)
    expect(queued).toEqual([
      expect.objectContaining({
        scheduledFor: new Date(SNOOZED),
        type: 'due_reminder',
        data: expect.objectContaining({ source: 'explicit', reminderType: 'push' }),
      }),
    ])
  })

  it('falls back to the automatic reminders when the explicit one is cleared', async () => {
    await send({ reminderTime: null })

    const sources = reminderQueue.create.mock.calls.map(([{ data }]) => data.data.source)
    expect(sources).toEqual(['automatic_update', 'automatic_update'])
  })
})
