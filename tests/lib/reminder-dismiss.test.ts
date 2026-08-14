/**
 * Task e0613ae5 — second slice, same pattern as lib/reminder-snooze.ts.
 *
 * `POST /api/reminders/:id/dismiss` and its v1 twin were another pair of
 * independent copies: same ownership check, same dismissAll fan-out, same
 * "mark the task reminderSent when nothing is left pending" rule. As with
 * snooze, they differ only in auth and the `meta` envelope, so the rule moves
 * to lib/ and both routes keep their own formatting.
 *
 * Dismiss has more branching than snooze, and the branch worth pinning hardest
 * is `dismissAll && reminder.taskId`: asking to dismiss all reminders for a
 * reminder that belongs to no task must fall through to dismissing just that
 * one, not delete somebody's whole queue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminderQueue: {
      findUnique: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn(),
      delete: vi.fn(), count: vi.fn(),
    },
    task: { update: vi.fn() },
  },
}))

import { dismissReminder } from '@/lib/reminder-dismiss'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)

const REMINDER = { id: 'rem-1', userId: 'owner-1', taskId: 'task-1' }

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.reminderQueue.findUnique.mockResolvedValue({ ...REMINDER } as never)
  mockPrisma.reminderQueue.findMany.mockResolvedValue([] as never)
  mockPrisma.reminderQueue.count.mockResolvedValue(0 as never)
})

describe('dismissReminder (task e0613ae5)', () => {
  it('refuses a reminder that does not exist', async () => {
    mockPrisma.reminderQueue.findUnique.mockResolvedValue(null as never)

    const result = await dismissReminder({ reminderId: 'nope', userId: 'owner-1', dismissAll: false })

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(mockPrisma.reminderQueue.delete).not.toHaveBeenCalled()
    expect(mockPrisma.reminderQueue.deleteMany).not.toHaveBeenCalled()
  })

  it("refuses someone else's reminder", async () => {
    const result = await dismissReminder({ reminderId: 'rem-1', userId: 'stranger', dismissAll: false })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(mockPrisma.reminderQueue.delete).not.toHaveBeenCalled()
    expect(mockPrisma.reminderQueue.deleteMany).not.toHaveBeenCalled()
  })

  it('dismisses just the one, and marks the task when nothing is left pending', async () => {
    mockPrisma.reminderQueue.count.mockResolvedValue(0 as never)

    const result = await dismissReminder({ reminderId: 'rem-1', userId: 'owner-1', dismissAll: false })

    expect(result).toMatchObject({ ok: true, dismissedCount: 1 })
    expect(mockPrisma.reminderQueue.delete).toHaveBeenCalledWith({ where: { id: 'rem-1' } })
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' }, data: { reminderSent: true },
    })
  })

  it('leaves the task alone when other reminders are still pending', async () => {
    mockPrisma.reminderQueue.count.mockResolvedValue(2 as never)

    const result = await dismissReminder({ reminderId: 'rem-1', userId: 'owner-1', dismissAll: false })

    expect(result).toMatchObject({ ok: true, dismissedCount: 1 })
    expect(mockPrisma.task.update).not.toHaveBeenCalled()
  })

  it('dismissAll clears every pending reminder for the task and counts them', async () => {
    mockPrisma.reminderQueue.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as never)

    const result = await dismissReminder({ reminderId: 'rem-1', userId: 'owner-1', dismissAll: true })

    expect(result).toMatchObject({ ok: true, dismissedCount: 3 })
    expect(mockPrisma.reminderQueue.deleteMany).toHaveBeenCalledWith({
      where: { taskId: 'task-1', userId: 'owner-1', status: 'pending' },
    })
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 'task-1' }, data: { reminderSent: true },
    })
  })

  it('dismissAll on a reminder with NO task dismisses only that reminder', async () => {
    // The edge the original `dismissAll && reminder.taskId` guard exists for.
    // Without it, a task-less reminder would take the fan-out path with
    // taskId: null and could match far more rows than the caller asked for.
    mockPrisma.reminderQueue.findUnique.mockResolvedValue({
      ...REMINDER, taskId: null,
    } as never)

    const result = await dismissReminder({ reminderId: 'rem-1', userId: 'owner-1', dismissAll: true })

    expect(result).toMatchObject({ ok: true, dismissedCount: 1 })
    expect(mockPrisma.reminderQueue.deleteMany).not.toHaveBeenCalled()
    expect(mockPrisma.reminderQueue.delete).toHaveBeenCalledWith({ where: { id: 'rem-1' } })
    expect(mockPrisma.task.update).not.toHaveBeenCalled()
  })
})
