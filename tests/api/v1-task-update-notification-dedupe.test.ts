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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth-wrapper', () => ({
  withAuth: (_opts: unknown, handler: (...args: unknown[]) => unknown) =>
    (req: NextRequest, ctx: unknown) =>
      handler(req, { userId: 'user-1', scopes: ['tasks:write'], source: 'oauth', isAIAgent: false }, ctx),
}))

const taskUpdate = vi.hoisted(() => vi.fn())
const taskFindUnique = vi.hoisted(() => vi.fn())
const notificationCreateMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: taskFindUnique, update: taskUpdate, findFirst: vi.fn() },
    taskList: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn() },
    taskEvent: { createMany: vi.fn() },
    notification: { createMany: notificationCreateMany },
  },
}))

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/api-auth-middleware', () => ({
  getDeprecationWarning: () => null,
  requireTaskAccess: vi.fn().mockResolvedValue(undefined),
  requireTaskReadAccess: vi.fn().mockResolvedValue(undefined),
}))

const BEFORE = {
  id: 'task-1',
  title: 'Old title',
  completed: false,
  closedReason: null,
  priority: 1,
  creatorId: 'user-1',
  assigneeId: 'assignee-1',
  parentTaskId: null,
  dueDateTime: null,
  lists: [{ id: 'list-1', ownerId: 'user-1', listMembers: [], privacy: 'PRIVATE' }],
  comments: [],
}

// The update lands the task on two additional lists in the same edit — what
// the label-list picker in task detail sends.
const AFTER = {
  ...BEFORE,
  title: 'New title',
  lists: [{ id: 'list-1' }, { id: 'list-2' }, { id: 'list-3' }],
}

const ctx = { params: Promise.resolve({ id: 'task-1' }) } as never

beforeEach(() => {
  vi.clearAllMocks()
  taskFindUnique.mockResolvedValue(BEFORE)
  taskUpdate.mockResolvedValue(AFTER)
})

describe('PUT /api/v1/tasks/[id] notification dedupe (task ceaff1c5)', () => {
  it('adding two lists in one edit produces one status_changed row per recipient', async () => {
    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const response = await PUT(
      new NextRequest('http://localhost/api/v1/tasks/task-1', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'New title' }),
      }),
      ctx
    )
    expect(response.status).toBe(200)

    // ONE persist for the whole update, so the row-level dedupe can see every
    // event's targets at once.
    expect(notificationCreateMany).toHaveBeenCalledTimes(1)

    const rows = notificationCreateMany.mock.calls.flatMap(
      call => (call[0] as { data: Array<{ userId: string; kind: string }> }).data
    )
    const statusRowsForAssignee = rows.filter(
      row => row.userId === 'assignee-1' && row.kind === 'status_changed'
    )
    expect(statusRowsForAssignee).toHaveLength(1)
  })
})
