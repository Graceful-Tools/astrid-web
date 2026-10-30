import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const reminderQueue = vi.hoisted(() => ({
  updateMany: vi.fn(),
  create: vi.fn(),
  findFirst: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: { reminderQueue } }))

import { computeAutomaticReminders, rescheduleRemindersForUpdate } from '@/lib/reminder-scheduling'

describe('reminder-scheduling — computeAutomaticReminders', () => {
  const fixedNow = new Date('2026-04-28T12:00:00Z')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty array for past due dates', () => {
    const past = new Date(fixedNow.getTime() - 60_000)
    expect(computeAutomaticReminders(past)).toEqual([])
  })

  it('schedules a 15-min-before due reminder + 1-hour-after overdue reminder for future dates', () => {
    const due = new Date(fixedNow.getTime() + 60 * 60 * 1000) // +1h
    const result = computeAutomaticReminders(due)

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({
      scheduledFor: new Date(due.getTime() - 15 * 60 * 1000),
      type: 'due_reminder',
      source: 'automatic',
    })
    expect(result[1]).toEqual({
      scheduledFor: new Date(due.getTime() + 60 * 60 * 1000),
      type: 'overdue_reminder',
      source: 'automatic',
    })
  })

  it('falls back to due-time itself when due is less than 15min away', () => {
    const due = new Date(fixedNow.getTime() + 5 * 60 * 1000) // +5min
    const result = computeAutomaticReminders(due)

    expect(result[0].scheduledFor).toEqual(due)
    expect(result[0].type).toBe('due_reminder')
  })

  it('honors a custom source label', () => {
    const due = new Date(fixedNow.getTime() + 60 * 60 * 1000)
    const result = computeAutomaticReminders(due, 'automatic_update')
    expect(result.every(r => r.source === 'automatic_update')).toBe(true)
  })

  it('produces the same schedule whether called from POST-create or PUT-update flow', () => {
    // Regression test: POST and PUT routes both call this helper with the same
    // due date, so they should produce identical reminder rows. This is the
    // structural guarantee that the routes can't drift apart on reminder timing.
    const due = new Date(fixedNow.getTime() + 24 * 60 * 60 * 1000)

    const fromPost = computeAutomaticReminders(due, 'automatic')
    const fromPut = computeAutomaticReminders(due, 'automatic_update')

    expect(fromPost.map(r => ({ scheduledFor: r.scheduledFor, type: r.type })))
      .toEqual(fromPut.map(r => ({ scheduledFor: r.scheduledFor, type: r.type })))
  })
})

/**
 * The update path's decisions. These replace the assertions-on-literals in
 * the deleted tests/integration/reminder-system-integration.test.ts
 * ("should not schedule reminders for completed tasks"), which never called
 * this code (AWTD-1422).
 */
describe('reminder-scheduling — rescheduleRemindersForUpdate', () => {
  const fixedNow = new Date('2026-04-28T12:00:00Z')
  const due = new Date(fixedNow.getTime() + 2 * 60 * 60 * 1000) // +2h

  const task = {
    id: 'task-1',
    title: 'Water the plants',
    completed: false,
    assigneeId: 'assignee-1',
    creatorId: 'creator-1',
    dueDateTime: due,
    reminderTime: null,
    reminderType: null,
  }

  const createdRows = () => reminderQueue.create.mock.calls.map(([arg]) => arg.data)

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(fixedNow)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does nothing when no reminder-relevant field changed', async () => {
    await rescheduleRemindersForUpdate({
      before: task,
      after: { ...task, title: 'Renamed' },
      actorId: 'actor-1',
    })

    expect(reminderQueue.updateMany).not.toHaveBeenCalled()
    expect(reminderQueue.create).not.toHaveBeenCalled()
  })

  it('cancels pending reminders and queues none when the task is completed', async () => {
    await rescheduleRemindersForUpdate({
      before: task,
      after: { ...task, completed: true },
      actorId: 'actor-1',
    })

    expect(reminderQueue.updateMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1', status: 'pending' },
      data: { status: 'cancelled' },
    })
    expect(reminderQueue.create).not.toHaveBeenCalled()
  })

  it('re-queues the automatic schedule for the assignee when a task is reopened', async () => {
    await rescheduleRemindersForUpdate({
      before: { ...task, completed: true },
      after: task,
      actorId: 'actor-1',
    })

    expect(createdRows()).toEqual(
      computeAutomaticReminders(due, 'automatic_update').map(r => ({
        taskId: 'task-1',
        userId: 'assignee-1',
        scheduledFor: r.scheduledFor,
        type: r.type,
        status: 'pending',
        data: { taskTitle: 'Water the plants', taskId: 'task-1', source: 'automatic_update' },
      }))
    )
  })

  it('queues nothing when the new due date is already past', async () => {
    await rescheduleRemindersForUpdate({
      before: task,
      after: { ...task, dueDateTime: new Date(fixedNow.getTime() - 60_000) },
      actorId: 'actor-1',
    })

    expect(reminderQueue.updateMany).toHaveBeenCalledOnce()
    expect(reminderQueue.create).not.toHaveBeenCalled()
  })

  it('prefers a future explicit reminderTime over the automatic schedule', async () => {
    const snoozed = new Date(fixedNow.getTime() + 30 * 60 * 1000)
    await rescheduleRemindersForUpdate({
      before: task,
      after: { ...task, reminderTime: snoozed, reminderType: 'push' },
      actorId: 'actor-1',
    })

    expect(createdRows()).toEqual([
      expect.objectContaining({
        scheduledFor: snoozed,
        type: 'due_reminder',
        data: expect.objectContaining({ source: 'explicit', reminderType: 'push' }),
      }),
    ])
  })

  it('falls back to the actor when the task has neither assignee nor creator', async () => {
    await rescheduleRemindersForUpdate({
      before: { ...task, assigneeId: null, creatorId: null, dueDateTime: null },
      after: { ...task, assigneeId: null, creatorId: null },
      actorId: 'actor-1',
    })

    expect(createdRows().map(r => r.userId)).toEqual(['actor-1', 'actor-1'])
  })

  it('never throws when the queue write fails', async () => {
    reminderQueue.updateMany.mockRejectedValueOnce(new Error('db down'))

    await expect(
      rescheduleRemindersForUpdate({ before: task, after: { ...task, completed: true }, actorId: 'a' })
    ).resolves.toBeUndefined()
  })
})
