/**
 * ADEV-71: who decides whether a notification's Complete may complete.
 *
 * The service worker cannot show "Complete this task?", so it completes only
 * when the notification says `completesWithoutAsking: true` and otherwise opens
 * the task (tests/lib/sw-notification-actions.test.ts). The SENDERS answer that
 * with the one rule every completion surface asks, `completionNeedsConfirmation`:
 * the cron's reminder push for the reminder's recipient, and the page's
 * client-side reminders for the signed-in user.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { ReminderService } from '@/lib/reminder-service'
import { clientReminderSync } from '@/lib/client-reminder-sync'

function cron(assigneeId: string | null) {
  const prisma = {
    reminderQueue: {
      findMany: vi.fn().mockResolvedValue([{
        id: 'r1', taskId: 't1', userId: 'u1', type: 'due_reminder', status: 'pending',
        scheduledFor: new Date('2024-01-15T15:00:00Z'),
        task: {
          id: 't1', title: 'Pay rent', dueDateTime: new Date('2024-01-15T16:00:00Z'),
          reminderType: 'push', assigneeId, creatorId: 'u1', lists: [],
        },
        user: { email: 'u@example.com', name: 'U', locale: null },
      }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(),
    },
    reminderSettings: {
      findUnique: vi.fn().mockResolvedValue({
        enablePushReminders: true, enableEmailReminders: false, dailyDigestTimezone: 'UTC',
        quietHoursStart: null, quietHoursEnd: null,
      }),
    },
    listMember: { findMany: vi.fn().mockResolvedValue([]) },
    taskList: { findMany: vi.fn().mockResolvedValue([]) },
    shortcode: { findFirst: vi.fn().mockResolvedValue(null) },
    task: { findUnique: vi.fn(), update: vi.fn() },
  }
  const email = { sendTaskReminder: vi.fn(), sendDailyDigest: vi.fn(), sendWeeklyDigest: vi.fn() }
  const push = { sendNotification: vi.fn() }
  return { service: new ReminderService(prisma as unknown as PrismaClient, email, push), push }
}

describe("the cron's reminder push says whether Complete may complete (ADEV-71)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T15:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it("the recipient's own task completes from the notification", async () => {
    const { service, push } = cron('u1')
    await service.processDueReminders()
    expect(push.sendNotification.mock.calls[0][1].data.completesWithoutAsking).toBe(true)
  })

  for (const [who, assigneeId] of [["someone else's", 'u2'], ['an unassigned', null]] as const) {
    it(`${who} task opens instead`, async () => {
      const { service, push } = cron(assigneeId)
      await service.processDueReminders()
      expect(push.sendNotification.mock.calls[0][1].data.completesWithoutAsking).toBe(false)
    })
  }
})

describe("the page's client-side reminders say the same (ADEV-71)", () => {
  const postMessage = vi.fn()
  beforeEach(() => {
    postMessage.mockReset()
    ;(clientReminderSync as unknown as { serviceWorkerRegistration: unknown }).serviceWorkerRegistration = {
      active: { postMessage },
    }
  })

  const scheduled = () =>
    postMessage.mock.calls
      .filter(([message]) => message.type === 'SCHEDULE_REMINDER')
      .map(([message]) => message.data.completesWithoutAsking)

  const dueTomorrow = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  it('your own task: true', async () => {
    await clientReminderSync.scheduleTaskReminders({ id: 't1', title: 'Pay rent', dueDateTime: dueTomorrow(), assigneeId: 'u1' }, 'u1')
    expect(scheduled()).toEqual([true, true])
  })

  it("someone else's or nobody's: false", async () => {
    await clientReminderSync.scheduleTaskReminders({ id: 't1', title: 'Pay rent', dueDateTime: dueTomorrow(), assigneeId: 'u2' }, 'u1')
    await clientReminderSync.scheduleTaskReminders({ id: 't2', title: 'Pay rent', dueDateTime: dueTomorrow(), assigneeId: null }, 'u1')
    expect(scheduled()).toEqual([false, false, false, false])
  })
})
