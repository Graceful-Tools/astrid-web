/**
 * Dismissing a reminder — the rule, with no route around it.
 *
 * Shared by `POST /api/reminders/:id/dismiss` and its v1 twin, which were two
 * independent copies. Same reasoning as lib/reminder-snooze.ts: the routes are
 * not collapsed into one because their response shapes differ (v1 carries
 * `meta`) and both shapes are pinned by contract tests, so each keeps its own
 * auth and formatting and shares the part that was actually duplicated.
 * (Task e0613ae5.)
 */

import { prisma } from '@/lib/prisma'

export type DismissResult =
  | { ok: true; dismissedCount: number }
  | { ok: false; status: 403 | 404; error: string }

export async function dismissReminder(args: {
  reminderId: string
  userId: string
  dismissAll: boolean
}): Promise<DismissResult> {
  const { reminderId, userId, dismissAll } = args

  const reminder = await prisma.reminderQueue.findUnique({ where: { id: reminderId } })
  if (!reminder) {
    return { ok: false, status: 404, error: 'Reminder not found' }
  }
  if (reminder.userId !== userId) {
    return { ok: false, status: 403, error: 'Access denied' }
  }

  // `dismissAll` only means anything for a reminder that belongs to a task —
  // otherwise there is no set to fan out over, and matching on `taskId: null`
  // would sweep up unrelated reminders.
  if (dismissAll && reminder.taskId) {
    const scope = { taskId: reminder.taskId, userId, status: 'pending' }

    const taskReminders = await prisma.reminderQueue.findMany({ where: scope })
    await prisma.reminderQueue.deleteMany({ where: scope })

    await prisma.task.update({
      where: { id: reminder.taskId },
      data: { reminderSent: true },
    })

    return { ok: true, dismissedCount: taskReminders.length }
  }

  await prisma.reminderQueue.delete({ where: { id: reminderId } })

  // Mark the task done with reminders only once none are left pending.
  if (reminder.taskId) {
    const remaining = await prisma.reminderQueue.count({
      where: { taskId: reminder.taskId, userId, status: 'pending' },
    })
    if (remaining === 0) {
      await prisma.task.update({
        where: { id: reminder.taskId },
        data: { reminderSent: true },
      })
    }
  }

  return { ok: true, dismissedCount: 1 }
}
