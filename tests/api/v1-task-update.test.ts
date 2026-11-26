/**
 * PUT/GET /api/v1/tasks/[id] — every behaviour of the update route in one file.
 *
 * Merged from six per-bug files (ADEV-300): empty-string clearing, wrong-typed
 * scalars, occurrenceCount, reminderTime, notification dedupe and the comment cap
 * on task responses. Add new behaviour as a new `describe` here, with the task id
 * in the name, rather than a new file.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, type Mock } from 'vitest'
import { mockPrisma } from '../setup'
import {
  callRoute,
  ensurePrismaModels,
  removePrismaModels,
  resetRouteHarness,
  signIn,
} from '../utils/route-harness'
// AWTD-1462: reminders, notifications, stats and dependents run after the
// response (a task-updated job); held here and flushed before asserting.
import { flushAfterResponse, discardAfterResponse } from '../utils/after-response'
import { TASK_COMMENTS_RESPONSE_LIMIT } from '@/lib/task-query-utils'

vi.mock('@/lib/background', async () => (await import('../utils/after-response')).backgroundMock)
vi.mock('@/lib/api-auth-middleware', async () =>
  (await import('../utils/route-harness')).authMiddlewareMock()
)
vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))

const prisma = mockPrisma as any
const taskUpdate = prisma.task.update as Mock
const taskFindUnique = prisma.task.findUnique as Mock

const PRIVATE_LIST = { id: 'list-1', ownerId: 'user-1', listMembers: [], privacy: 'PRIVATE' }

const routeModule = () => import('@/app/api/v1/tasks/[id]/route')

/**
 * Warm the route module before the timed tests (task aca946b8).
 *
 * The first test to import this route's module graph paid the transform cost
 * inside its 5000ms budget; under the full suite that competes with every other
 * worker for CPU and the first test timed out. A hook gets the 10s budget, and
 * later imports hit the module cache.
 */
beforeAll(async () => {
  await routeModule()
})

beforeEach(() => {
  resetRouteHarness()
  discardAfterResponse()
  signIn({ userId: 'user-1', scopes: ['tasks:write'] })
  // No Job table: enqueueJob runs its handler after the response, and flushAfterResponse awaits it.
  removePrismaModels('job')
  ensurePrismaModels({
    taskEvent: ['createMany'],
    notification: ['createMany'],
    reminderQueue: ['updateMany', 'create', 'findFirst'],
  })
})

async function put(body: unknown) {
  const { PUT } = await routeModule()
  return callRoute(PUT as never, {
    path: '/api/v1/tasks/task-1',
    id: 'task-1',
    method: 'PUT',
    body,
  })
}

/** The `data` object handed to prisma.task.update for this request. */
async function updateDataFor(body: unknown) {
  await put(body)
  const call = taskUpdate.mock.calls[0]
  return call ? call[0].data : undefined
}

/**
 * Task 1e53501f — mobile clears fields with `''`, not `null`, and the route
 * must keep accepting both.
 *
 * iOS cannot send null on these: `UpdateTaskRequest.encode(to:)` is
 * `encodeIfPresent`, so a nil optional is OMITTED, which is how the client says
 * "leave unchanged". Clearing is expressed as an empty string.
 *
 * NOTHING IS BROKEN TODAY. This exists so it stays that way. A reader who takes
 * the empty-string case for sloppiness would break clearing on iOS silently — no
 * error, the write simply does nothing, and it looks like a client bug.
 *
 * The `assigneeId` case is the one to watch. Unlike the other two it is not an
 * explicit `=== ''`; it works only because `body.assigneeId || null` treats an
 * empty string as falsy. Rewriting that to `??` is a natural-looking
 * modernisation that keeps null working and breaks the only form iOS can send.
 */
describe('PUT /api/v1/tasks/:id accepts empty string as a clear (task 1e53501f)', () => {
  const TASK = {
    id: 'task-1',
    creatorId: 'user-1',
    assigneeId: 'someone',
    parentTaskId: 'parent-1',
    dueDateTime: new Date(),
    lists: [PRIVATE_LIST],
  }

  beforeEach(() => {
    taskFindUnique.mockResolvedValue(TASK)
    taskUpdate.mockResolvedValue({ ...TASK, comments: [] })
  })

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

/**
 * Task 87e19910 — a wrong-typed scalar must be a 400, not a 500.
 *
 * PUT /api/v1/tasks/:id builds `const data: any = {}` and copies request
 * fields straight in with only an `!== undefined` check. A client sending
 * priority: "high" handed Prisma a string for an Int column; Prisma rejects it,
 * the route had no catch for that, and the caller got a 500 for a bad request.
 *
 * dueDateTime is the subtle one. It goes through `new Date(...)`, and
 * `new Date('garbage')` is an Invalid Date rather than a throw. That reaches
 * Prisma too.
 */
describe('PUT /api/v1/tasks/:id rejects wrong-typed scalars (task 87e19910)', () => {
  const TASK = {
    id: 'task-1',
    creatorId: 'user-1',
    assigneeId: 'someone',
    parentTaskId: 'parent-1',
    dueDateTime: new Date(),
    lists: [PRIVATE_LIST],
  }

  beforeEach(() => {
    taskFindUnique.mockResolvedValue(TASK)
    taskUpdate.mockResolvedValue({ ...TASK, comments: [] })
  })

  it('400s on a non-numeric priority instead of handing Prisma a string', async () => {
    expect((await put({ priority: 'high' })).status).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('400s on a non-boolean completed', async () => {
    expect((await put({ completed: 'yes' })).status).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('400s on a non-string title rather than writing a number into a String column', async () => {
    expect((await put({ title: 123 })).status).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('400s on an unparseable dueDateTime rather than storing an Invalid Date', async () => {
    // new Date('garbage') does not throw — it yields Invalid Date, which is
    // why this one survives a naive try/catch and reaches the driver.
    expect((await put({ dueDateTime: 'garbage' })).status).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('still accepts the correct types', async () => {
    expect((await put({ priority: 2, completed: true, title: 'ok' })).status).toBe(200)
    expect(taskUpdate).toHaveBeenCalled()
  })

  it('leaves the empty-string clearing contract intact', async () => {
    // Guarding types must not break the iOS clearing convention (task 1e53501f):
    // '' is a legitimate value for these, not a type error.
    expect((await put({ dueDateTime: '' })).status).toBe(200)
    expect((await put({ assigneeId: '' })).status).toBe(200)
  })
})

/**
 * AWTD-1035 — completing a repeating task outside the web never counted the
 * occurrence, so "end after N times" never ended.
 *
 * The web completes with `completed: true` and the server rolls the task
 * forward, incrementing `occurrenceCount` itself. iOS, the Mac and astrid-core
 * (so Windows) roll on the device and send the new due date with
 * `completed: false`, so the server's roll never runs for them. The fix accepts
 * the client's count; every client computes it through astrid-core's
 * `repeating::completion`.
 */
describe('PUT /api/v1/tasks/:id writes occurrenceCount (AWTD-1035)', () => {
  const TASK = {
    id: 'task-1',
    creatorId: 'user-1',
    completed: false,
    repeating: 'daily',
    occurrenceCount: 2,
    dueDateTime: new Date('2026-09-28T09:00:00Z'),
    lists: [PRIVATE_LIST],
  }

  beforeEach(() => {
    taskFindUnique.mockResolvedValue(TASK)
    taskUpdate.mockResolvedValue({ ...TASK, comments: [] })
  })

  async function send(body: unknown) {
    const { status } = await put(body)
    const call = taskUpdate.mock.calls[0]
    return { status, data: call ? call[0].data : undefined }
  }

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

/**
 * AWTD-1038 — `PUT /api/v1/tasks/:id` ignored `reminderTime`.
 *
 * The create route has always taken it; the update route dropped it on the
 * floor, so the response carried the OLD reminder time. A snooze made on a
 * device was therefore undone by the answer to its own edit: the client applied
 * the returned row and the reminder jumped back.
 *
 * Same PATCH semantics as every other field on this route: absent leaves it
 * alone, `null` or `''` clears it (iOS can only send `''`).
 */
describe('PUT /api/v1/tasks/:id — reminderTime (AWTD-1038)', () => {
  const SNOOZED = '2030-01-01T09:30:00.000Z'
  const TASK = {
    id: 'task-1',
    title: 'Water the plants',
    creatorId: 'user-1',
    assigneeId: 'user-1',
    completed: false,
    dueDateTime: new Date('2030-01-01T10:00:00.000Z'),
    reminderTime: new Date('2030-01-01T09:00:00.000Z'),
    reminderType: 'push',
    reminderSent: true,
    lists: [PRIVATE_LIST],
  }
  const reminderQueue = () => prisma.reminderQueue

  beforeEach(() => {
    taskFindUnique.mockResolvedValue(TASK)
    // Echo the write back, as the database would.
    taskUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...TASK,
      ...data,
      comments: [],
    }))
  })

  it('writes a new reminderTime, so a snooze is not undone by its own response', async () => {
    const data = await updateDataFor({ reminderTime: SNOOZED })

    expect(data.reminderTime).toEqual(new Date(SNOOZED))
    // A moved reminder has not fired yet, whatever the old one did.
    expect(data.reminderSent).toBe(false)
  })

  it('answers with the reminder time the edit asked for', async () => {
    const { status, body } = await put({ reminderTime: SNOOZED })
    expect(status).toBe(200)
    expect(new Date(body.task.reminderTime).toISOString()).toBe(SNOOZED)
  })

  it('clears the reminder on null and on empty string', async () => {
    expect((await updateDataFor({ reminderTime: null })).reminderTime).toBeNull()
    taskUpdate.mockClear()
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
    expect((await put({ reminderTime: 'next tuesday-ish' })).status).toBe(400)
    expect(taskUpdate).not.toHaveBeenCalled()
  })

  it('rejects a wrong-typed reminderTime', async () => {
    expect((await put({ reminderTime: 42 })).status).toBe(400)
  })

  it('re-queues the explicit reminder at the new time', async () => {
    await put({ reminderTime: SNOOZED })
    await flushAfterResponse()

    // The old reminder is cancelled...
    expect(reminderQueue().updateMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1', status: 'pending' },
      data: { status: 'cancelled' },
    })
    // ...and only the snoozed one queued — not the due date's automatic set.
    const queued = reminderQueue().create.mock.calls.map(([{ data }]: any) => data)
    expect(queued).toEqual([
      expect.objectContaining({
        scheduledFor: new Date(SNOOZED),
        type: 'due_reminder',
        data: expect.objectContaining({ source: 'explicit', reminderType: 'push' }),
      }),
    ])
  })

  it('falls back to the automatic reminders when the explicit one is cleared', async () => {
    await put({ reminderTime: null })
    await flushAfterResponse()

    const sources = reminderQueue().create.mock.calls.map(([{ data }]: any) => data.data.source)
    expect(sources).toEqual(['automatic_update', 'automatic_update'])
  })
})

/**
 * One PUT that adds two lists must not notify anyone twice (task ceaff1c5).
 *
 * The buildNotificationRows dedupe is keyed userId:kind:taskId:commentId, but
 * it only spans a single persistNotifications call. The routes used to call
 * persistNotifications once PER diffed event, and diffTaskEvents emits one
 * list_added event per added list — both mapping to the same status_changed
 * kind — so adding two lists in one edit wrote two byte-identical rows per
 * audience member. Notification has no unique constraint to catch it at the DB.
 */
describe('PUT /api/v1/tasks/[id] notification dedupe (task ceaff1c5)', () => {
  it('adding two lists in one edit produces one status_changed row per recipient', async () => {
    const before = {
      id: 'task-1',
      title: 'Old title',
      completed: false,
      closedReason: null,
      priority: 1,
      creatorId: 'user-1',
      assigneeId: 'assignee-1',
      parentTaskId: null,
      dueDateTime: null,
      lists: [PRIVATE_LIST],
      comments: [],
    }
    // The update lands the task on two additional lists in the same edit — what
    // the label-list picker in task detail sends.
    const after = {
      ...before,
      title: 'New title',
      lists: [{ id: 'list-1' }, { id: 'list-2' }, { id: 'list-3' }],
    }
    taskFindUnique.mockResolvedValue(before)
    taskUpdate.mockResolvedValue(after)

    const { status } = await put({ title: 'New title' })
    expect(status).toBe(200)
    await flushAfterResponse()

    // ONE persist for the whole update, so the row-level dedupe can see every
    // event's targets at once.
    expect(prisma.notification.createMany).toHaveBeenCalledTimes(1)

    const rows = prisma.notification.createMany.mock.calls.flatMap(
      (call: any[]) => (call[0] as { data: Array<{ userId: string; kind: string }> }).data
    )
    const statusRowsForAssignee = rows.filter(
      (row: { userId: string; kind: string }) =>
        row.userId === 'assignee-1' && row.kind === 'status_changed'
    )
    expect(statusRowsForAssignee).toHaveLength(1)
  })
})

/**
 * Task responses must not embed an unbounded comment collection (task a86b5bed).
 *
 * A runaway GitHub comment-sync echo put 142k comments on one task, at which
 * point PUT /api/v1/tasks/[id] answered 500 — the write landed but the response
 * could not serialize the full collection. The cap is enforced in the query
 * (`take`), so these tests pin the query arguments — the property that matters is
 * "the response embeds at most TASK_COMMENTS_RESPONSE_LIMIT comments, the newest
 * ones, in the same ascending order as before".
 */
describe('comment cap on task responses (task a86b5bed)', () => {
  // Newest-first, as the capped query returns them.
  const commentsDesc = () => [
    { id: 'c-new', authorId: 'user-2', createdAt: new Date('2026-02-02') },
    { id: 'c-old', authorId: 'user-3', createdAt: new Date('2026-01-01') },
  ]
  const TASK = {
    id: 'task-1',
    title: 'Task',
    completed: false,
    closedReason: null,
    priority: 1,
    creatorId: 'user-1',
    assigneeId: null,
    parentTaskId: null,
    dueDateTime: null,
    lists: [PRIVATE_LIST],
  }

  const commentsArgOf = (mock: Mock) => {
    // The identifier resolver issues its own select-only findUnique first, so
    // pick the call that actually embeds comments.
    const call = mock.mock.calls.find(
      c => (c[0] as { include?: { comments?: unknown } }).include?.comments
    )
    expect(call).toBeDefined()
    return (call![0] as { include: { comments: { take?: number; orderBy: unknown } } }).include.comments
  }

  beforeEach(() => {
    taskFindUnique.mockResolvedValue({ ...TASK, comments: commentsDesc() })
    taskUpdate.mockResolvedValue({ ...TASK, comments: commentsDesc() })
  })

  it('GET bounds the embedded comments and keeps ascending order on the wire', async () => {
    const { GET } = await routeModule()
    const { status, body } = await callRoute(GET as never, {
      path: '/api/v1/tasks/task-1',
      id: 'task-1',
    })
    expect(status).toBe(200)

    const commentsArg = commentsArgOf(taskFindUnique)
    expect(commentsArg.take).toBe(TASK_COMMENTS_RESPONSE_LIMIT)
    // take slices from the top, so newest-first is what makes the cap keep
    // the NEWEST comments rather than the oldest.
    expect(commentsArg.orderBy).toEqual({ createdAt: 'desc' })
    expect(body.task.comments.map((c: { id: string }) => c.id)).toEqual(['c-old', 'c-new'])
  })

  it('PUT bounds the embedded comments and keeps ascending order on the wire', async () => {
    const { status, body } = await put({ title: 'Renamed' })
    expect(status).toBe(200)

    const commentsArg = commentsArgOf(taskUpdate)
    expect(commentsArg.take).toBe(TASK_COMMENTS_RESPONSE_LIMIT)
    expect(commentsArg.orderBy).toEqual({ createdAt: 'desc' })

    const ids = body.task.comments.map((c: { id: string }) => c.id)
    // Ascending order preserved; a state-change comment may be prepended.
    expect(ids.indexOf('c-old')).toBeLessThan(ids.indexOf('c-new'))
  })
})
