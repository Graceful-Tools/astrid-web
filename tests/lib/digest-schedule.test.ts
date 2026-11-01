/**
 * AWTD-1453: digests ran only at minute 0 of each hour, but matched users within ±5 min of their
 * chosen time, so 08:30 never sent. "Today" was also read off the server's clock (UTC), so a user
 * in California got tomorrow's tasks after 17:00.
 *
 * These tests drive the service the way the cron does, once per minute across a whole day, and
 * count what goes out.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { ReminderService } from '@/lib/reminder-service'
import type { DailyDigestData } from '@/types/reminder'
import { digestSettings, fakeDigestPrisma, type FakeTask } from '../utils/fake-digest-prisma'
import { nextDigestAt } from '@/lib/digest-schedule'

const TASKS: FakeTask[] = [
  // 23:30 on Jul 14 in Los Angeles: overdue on the 15th, although it is the 15th in UTC.
  { id: 'late-14th', title: 'Late on the 14th', dueDateTime: new Date('2026-07-15T06:30:00Z'), isAllDay: false, assigneeId: 'user1', completed: false, lists: [] },
  // 22:00 on Jul 15 in Los Angeles: due today, although it is already the 16th in UTC.
  { id: 'evening-15th', title: 'Evening of the 15th', dueDateTime: new Date('2026-07-16T05:00:00Z'), isAllDay: false, assigneeId: 'user1', completed: false, lists: [] },
  // All-day tasks are stored at UTC midnight of their calendar day.
  { id: 'all-day-15th', title: 'All day on the 15th', dueDateTime: new Date('2026-07-15T00:00:00Z'), isAllDay: true, assigneeId: 'user1', completed: false, lists: [] },
  { id: 'all-day-16th', title: 'All day on the 16th', dueDateTime: new Date('2026-07-16T00:00:00Z'), isAllDay: true, assigneeId: 'user1', completed: false, lists: [] },
]

function settings(dailyDigestTime: string, dailyDigestTimezone: string, overrides: Record<string, unknown> = {}) {
  return digestSettings('user1', { dailyDigestTime, dailyDigestTimezone, ...overrides })
}

function serviceFor(reminderSettings: ReturnType<typeof settings>) {
  // Stateful: the slot the service schedules and claims persists from one tick to the next.
  const { prisma } = fakeDigestPrisma([{ id: 'user1', email: 'user@example.com', name: 'Test User', settings: reminderSettings }], TASKS)
  const sentAt: string[] = []
  const email = {
    sendTaskReminder: vi.fn(),
    sendDailyDigest: vi.fn(async (_digest: DailyDigestData) => { sentAt.push(new Date().toISOString()) }),
    sendWeeklyDigest: vi.fn(async () => { sentAt.push(new Date().toISOString()) }),
  }
  const push = { sendNotification: vi.fn() }
  const service = new ReminderService(prisma as unknown as PrismaClient, email as any, push as any)
  return { service, email, sentAt }
}

/** Run the digest pass once per minute, as the cron does, from `start` for `minutes` minutes. */
async function tickEveryMinute(run: () => Promise<void>, start: Date, minutes: number) {
  for (let i = 0; i < minutes; i++) {
    vi.setSystemTime(new Date(start.getTime() + i * 60_000))
    await run()
  }
}

const ORIGINAL_TZ = process.env.TZ

describe('daily digest schedule (AWTD-1453)', () => {
  beforeEach(() => {
    // Production servers run in UTC; the bug only shows there.
    process.env.TZ = 'UTC'
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env.TZ = ORIGINAL_TZ
  })

  // 2026-07-15 00:00 in Los Angeles (PDT, UTC-7).
  const LA_MIDNIGHT = new Date('2026-07-15T07:00:00Z')

  it('AWTD-1453: a user at 08:30 America/Los_Angeles gets exactly one digest across the day, at 08:30', async () => {
    const { service, sentAt } = serviceFor(settings('08:30', 'America/Los_Angeles'))

    await tickEveryMinute(() => service.processDailyDigests(), LA_MIDNIGHT, 24 * 60)

    // 08:30 PDT is 15:30 UTC.
    expect(sentAt).toEqual(['2026-07-15T15:30:00.000Z'])
  })

  it('AWTD-1453: a user at 08:00 still gets exactly one digest across the day', async () => {
    const { service, sentAt } = serviceFor(settings('08:00', 'America/Los_Angeles'))

    await tickEveryMinute(() => service.processDailyDigests(), LA_MIDNIGHT, 24 * 60)

    expect(sentAt).toEqual(['2026-07-15T15:00:00.000Z'])
  })

  it("AWTD-1453: the digest's today / tomorrow / overdue are the user's calendar days, not the server's", async () => {
    // Send at 17:30 in Los Angeles, which is 00:30 UTC on the 16th: the server's "today" is the
    // wrong day entirely.
    const sendAt = new Date('2026-07-16T00:30:00Z')
    const { service, email } = serviceFor(settings('17:30', 'America/Los_Angeles', { nextDailyDigestAt: sendAt }))

    vi.setSystemTime(sendAt)
    await service.processDailyDigests()

    expect(email.sendDailyDigest).toHaveBeenCalledTimes(1)
    const digest = email.sendDailyDigest.mock.calls[0][0]
    const ids = (tasks: { taskId: string }[]) => tasks.map((t) => t.taskId).sort()
    expect(ids(digest.dueTodayTasks)).toEqual(['all-day-15th', 'evening-15th'])
    expect(ids(digest.dueTomorrowTasks)).toEqual(['all-day-16th'])
    expect(ids(digest.overdueTasks)).toEqual(['late-14th'])
  })

  it("AWTD-1453: the weekly digest goes out once, on the user's Monday, not the server's", async () => {
    // Pacific/Auckland is UTC+12 in July: 09:00 on Monday 13 July there is 21:00 UTC on
    // Sunday 12 July, a day the server would never send on.
    const { service, sentAt } = serviceFor(settings('09:00', 'Pacific/Auckland'))

    await tickEveryMinute(() => service.processWeeklyDigests(), new Date('2026-07-11T00:00:00Z'), 4 * 24 * 60)

    expect(sentAt).toEqual(['2026-07-12T21:00:00.000Z'])
  })
})

describe('the cron runs the digest pass every minute (AWTD-1453)', () => {
  it('AWTD-1453: calls the digest pass at a minute other than :00', async () => {
    vi.resetModules()
    const processDailyDigests = vi.fn(async () => {})
    const processWeeklyDigests = vi.fn(async () => {})
    vi.doMock('@/lib/reminder-service', () => ({
      ReminderService: class {
        processDueReminders = vi.fn(async () => ({ due: 0, sent: 0, failed: 0, staleReleased: 0 }))
        retryFailedReminders = vi.fn(async () => ({ eligible: 0, rescheduled: 0, failed: 0 }))
        processDailyDigests = processDailyDigests
        processWeeklyDigests = processWeeklyDigests
      },
    }))
    vi.doMock('@/lib/email-reminder-service', () => ({ EmailReminderService: class {} }))
    vi.doMock('@/lib/push-notification-service', () => ({ PushNotificationService: class {} }))
    vi.doMock('@/lib/agent-task-scheduler', () => ({ processAgentTasksDueSoon: vi.fn(async () => 0) }))
    vi.doMock('@/services/task-dependency.service', () => ({ promoteDueUnblockedTasks: vi.fn(async () => []) }))
    vi.doMock('@/lib/prisma', () => ({ prisma: {} }))
    vi.doMock('@/lib/cron-auth', () => ({ requireCronSecret: () => null }))

    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-15T15:30:00Z'))
    try {
      const { GET } = await import('@/app/api/cron/reminders/route')
      const { NextRequest } = await import('next/server')
      await GET(new NextRequest('http://localhost/api/cron/reminders'))
    } finally {
      vi.useRealTimers()
    }

    expect(processDailyDigests).toHaveBeenCalledTimes(1)
    expect(processWeeklyDigests).toHaveBeenCalledTimes(1)
  })
})

describe('digest slots (AWTD-1454)', () => {
  beforeEach(() => {
    process.env.TZ = 'UTC'
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    process.env.TZ = ORIGINAL_TZ
  })

  it('AWTD-1454: a missed cron minute sends on the next tick instead of skipping the day', async () => {
    const { service, sentAt } = serviceFor(settings('08:30', 'America/Los_Angeles'))
    vi.setSystemTime(new Date('2026-07-15T07:00:00Z'))
    await service.processDailyDigests() // schedules 08:30 PDT

    // The 08:30 tick never ran; the next one is 08:32.
    vi.setSystemTime(new Date('2026-07-15T15:32:00Z'))
    await service.processDailyDigests()
    vi.setSystemTime(new Date('2026-07-15T15:33:00Z'))
    await service.processDailyDigests()

    expect(sentAt).toEqual(['2026-07-15T15:32:00.000Z'])
  })

  it('AWTD-1454: two overlapping runs at the same minute send one digest', async () => {
    const { service, sentAt } = serviceFor(settings('08:30', 'America/Los_Angeles', { nextDailyDigestAt: new Date('2026-07-15T15:30:00Z') }))
    vi.setSystemTime(new Date('2026-07-15T15:30:00Z'))

    await Promise.all([service.processDailyDigests(), service.processDailyDigests()])

    expect(sentAt).toHaveLength(1)
  })

  it('AWTD-1454: a slot missed by hours (cron down) moves on without a stale send', async () => {
    const { service, sentAt } = serviceFor(settings('08:30', 'America/Los_Angeles', { nextDailyDigestAt: new Date('2026-07-15T15:30:00Z') }))
    vi.setSystemTime(new Date('2026-07-15T22:00:00Z'))

    await service.processDailyDigests()

    expect(sentAt).toEqual([])
  })
})

describe('nextDigestAt (AWTD-1454)', () => {
  it('is the next local occurrence, across a DST change', () => {
    // US fall-back is 2026-11-01: 08:30 PDT on Oct 31 is 15:30Z, 08:30 PST on Nov 1 is 16:30Z.
    expect(nextDigestAt('08:30', 'America/Los_Angeles', new Date('2026-10-31T15:30:00Z')).toISOString()).toBe('2026-11-01T16:30:00.000Z')
  })

  it('lands an hour later for a time the spring-forward skips', () => {
    // 2026-03-08 02:30 does not exist in Los Angeles; 03:30 PDT is 10:30Z.
    expect(nextDigestAt('02:30', 'America/Los_Angeles', new Date('2026-03-08T08:00:00Z')).toISOString()).toBe('2026-03-08T10:30:00.000Z')
  })

  it("picks the zone's Monday for the weekly slot", () => {
    // Wednesday 15 July → Monday 20 July, 09:00 Auckland (UTC+12) = 21:00Z on Sunday the 19th.
    expect(nextDigestAt('09:00', 'Pacific/Auckland', new Date('2026-07-15T00:00:00Z'), 1).toISOString()).toBe('2026-07-19T21:00:00.000Z')
  })
})
