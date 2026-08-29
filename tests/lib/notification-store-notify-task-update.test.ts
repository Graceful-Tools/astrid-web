/**
 * notifyTaskUpdate persists a whole update's events in ONE call so the
 * userId:kind:taskId dedupe in buildNotificationRows can actually see the
 * duplicates (task ceaff1c5).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({
  prisma: { notification: { createMany } },
}))

import { notifyTaskUpdate } from '@/lib/notification-store'

beforeEach(() => {
  vi.clearAllMocks()
  createMany.mockResolvedValue({ count: 1 })
})

describe('notifyTaskUpdate (task ceaff1c5)', () => {
  it('collapses two list_added events into one status_changed row per recipient', async () => {
    await notifyTaskUpdate({
      taskId: 'task-1',
      actorId: 'actor-1',
      events: [
        { kind: 'list_added', from: null, to: 'list-2' },
        { kind: 'list_added', from: null, to: 'list-3' },
      ],
      audience: { assigneeId: 'assignee-1', creatorId: 'actor-1' },
    })

    expect(createMany).toHaveBeenCalledTimes(1)
    const rows = createMany.mock.calls[0][0].data as Array<{ userId: string; kind: string }>
    expect(rows).toEqual([{ userId: 'assignee-1', kind: 'status_changed', taskId: 'task-1', commentId: null, actorId: 'actor-1' }])
  })

  it('keeps distinct kinds for the same recipient', async () => {
    await notifyTaskUpdate({
      taskId: 'task-1',
      actorId: 'actor-1',
      events: [
        { kind: 'assigned', from: null, to: 'assignee-1' },
        { kind: 'list_added', from: null, to: 'list-2' },
      ],
      audience: { assigneeId: 'assignee-1', creatorId: 'actor-1' },
    })

    const rows = createMany.mock.calls[0][0].data as Array<{ kind: string }>
    expect(rows.map(r => r.kind).sort()).toEqual(['assigned', 'status_changed'])
  })
})
