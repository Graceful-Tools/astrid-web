/**
 * Snoozing a reminder — the rule, with no route around it.
 *
 * `POST /api/reminders/:id/snooze` and `POST /api/v1/reminders/:id/snooze` were
 * two independent copies of this logic. They agreed when written and had no
 * test asserting they still did, which is how the other pairs in this codebase
 * have drifted (tasks 92e582c6, 641a7615).
 *
 * They are NOT collapsed into one route, because their response shapes
 * genuinely differ — v1 carries a `meta` envelope, legacy does not, and both
 * shapes are pinned by contract tests. So each route keeps its own auth and its
 * own formatting, and shares the part that was actually duplicated. That is the
 * pattern the remaining pairs should follow when a straight re-export would
 * change a response shape. (Task e0613ae5.)
 */

import { prisma } from '@/lib/prisma'

/** A reminder may be pushed out at most this many times. */
export const MAX_SNOOZE_COUNT = 5

export type SnoozeResult =
  | { ok: true; scheduledFor: Date; snoozeCount: number }
  | { ok: false; status: 400 | 403 | 404; error: string }

export async function snoozeReminder(args: {
  reminderId: string
  userId: string
  minutes: number
}): Promise<SnoozeResult> {
  const { reminderId, userId, minutes } = args

  const reminder = await prisma.reminderQueue.findUnique({ where: { id: reminderId } })
  if (!reminder) {
    return { ok: false, status: 404, error: 'Reminder not found' }
  }
  if (reminder.userId !== userId) {
    return { ok: false, status: 403, error: 'Access denied' }
  }

  const reminderData = (reminder.data as Record<string, unknown> | null) ?? {}
  const currentSnoozeCount = (reminderData.snoozeCount as number | undefined) ?? 0
  if (currentSnoozeCount >= MAX_SNOOZE_COUNT) {
    return {
      ok: false,
      status: 400,
      error: `maximum snooze limit reached (${MAX_SNOOZE_COUNT} times)`,
    }
  }

  const newScheduledFor = new Date(Date.now() + minutes * 60 * 1000)

  const updated = await prisma.reminderQueue.update({
    where: { id: reminderId },
    data: {
      scheduledFor: newScheduledFor,
      retryCount: (reminder.retryCount || 0) + 1,
      status: 'pending',
      data: {
        ...reminderData,
        snoozedAt: new Date(),
        snoozeCount: currentSnoozeCount + 1,
        // Keep the first value: on a second snooze, `reminder.scheduledFor` is
        // already a snoozed time, so overwriting here would lose when the
        // reminder was actually due.
        originalScheduledFor: reminderData.originalScheduledFor ?? reminder.scheduledFor,
      },
    },
  })

  return {
    ok: true,
    scheduledFor: updated.scheduledFor,
    snoozeCount: currentSnoozeCount + 1,
  }
}
