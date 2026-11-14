/**
 * AWTD-1592 — the cron's reminder push and reminder email follow the
 * recipient's `User.locale`, read from the row the reminder query already loads.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { ReminderService } from '@/lib/reminder-service'
import de from '@/lib/i18n/locales/de.json'

function setup(locale: string | null) {
  const prisma = {
    reminderQueue: {
      findMany: vi.fn().mockResolvedValue([{
        id: 'r1', taskId: 't1', userId: 'u1', type: 'due_reminder', status: 'pending',
        scheduledFor: new Date('2024-01-15T15:00:00Z'),
        task: {
          id: 't1', title: 'Miete zahlen', dueDateTime: new Date('2024-01-15T16:00:00Z'),
          reminderType: 'both', assigneeId: 'u1', creatorId: 'u1', lists: [{ id: 'l1', name: 'Haus' }],
        },
        user: { email: 'u@example.com', name: 'U', locale },
      }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      update: vi.fn(),
    },
    reminderSettings: {
      findUnique: vi.fn().mockResolvedValue({
        enablePushReminders: true, enableEmailReminders: true, dailyDigestTimezone: 'Europe/Berlin',
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
  return { service: new ReminderService(prisma as unknown as PrismaClient, email, push), email, push }
}

describe('reminder push and email language (AWTD-1592)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-15T15:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('a German user gets a German reminder push, with a German clock', async () => {
    const { service, push } = setup('de')
    await service.processDueReminders()
    const [, payload] = push.sendNotification.mock.calls[0]
    expect(payload.title).toBe(de.notifications.push.dueSoonTitle)
    expect(payload.body).toContain('Miete zahlen')
    expect(payload.body).toContain('17:00')
    expect(payload.actions.map((a: { title: string }) => a.title)).toEqual([
      de.notifications.actions.snooze15,
      de.notifications.actions.snooze60,
      de.notifications.actions.markComplete,
    ])
  })

  it('an unknown language keeps the English push exactly', async () => {
    const { service, push } = setup(null)
    await service.processDueReminders()
    const [, payload] = push.sendNotification.mock.calls[0]
    expect(payload.title).toBe('Task Due Soon')
    expect(payload.body).toBe('Miete zahlen is due at 5:00 PM')
    expect(payload.actions.map((a: { title: string }) => a.title)).toEqual(['Snooze 15min', 'Snooze 1hr', 'Mark Complete'])
  })

  it('hands the email the recipient language', async () => {
    const { service, email } = setup('de')
    await service.processDueReminders()
    expect(email.sendTaskReminder).toHaveBeenCalledWith(expect.objectContaining({ locale: 'de' }))
  })
})
