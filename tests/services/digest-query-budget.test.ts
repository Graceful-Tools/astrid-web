/**
 * AWTD-1454: the digest pass read every User row (with its settings) on every run, then decided
 * in JS who was due. AWTD-783 described the same scan and closed with no change landed.
 *
 * Pinned here as a budget, in the style of github-projects-apply-query-budget.test.ts: the rows a
 * cron tick reads, and the statements it issues, grow with the users who are DUE, not with the
 * size of the table.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { ReminderService } from '@/lib/reminder-service'
import { digestSettings, fakeDigestPrisma, type FakeDigestUser, type FakeTask } from '../utils/fake-digest-prisma'

const NOW = new Date('2026-07-15T09:00:00Z') // a Wednesday
const TOMORROW_9AM = new Date('2026-07-16T09:00:00Z')
const NEXT_MONDAY_9AM = new Date('2026-07-20T09:00:00Z')

/** `total` users, all with digests on and already scheduled; the first `due` are due now. */
function population(total: number, due: number): FakeDigestUser[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `user${i}`,
    email: `user${i}@example.com`,
    name: `User ${i}`,
    settings: digestSettings(`user${i}`, {
      nextDailyDigestAt: i < due ? NOW : TOMORROW_9AM,
      nextWeeklyDigestAt: NEXT_MONDAY_9AM,
    }),
  }))
}

const TASKS: FakeTask[] = Array.from({ length: 5 }, (_, i) => ({
  id: `task${i}`,
  title: `Task ${i}`,
  dueDateTime: new Date('2026-07-15T17:00:00Z'),
  isAllDay: false,
  assigneeId: `user${i}`,
  completed: false,
  lists: [],
}))

async function tick(users: FakeDigestUser[]) {
  const { prisma, stats } = fakeDigestPrisma(users, TASKS)
  const email = { sendTaskReminder: vi.fn(), sendDailyDigest: vi.fn(), sendWeeklyDigest: vi.fn() }
  const service = new ReminderService(prisma as unknown as PrismaClient, email as any, { sendNotification: vi.fn() } as any)
  await service.processDailyDigests()
  await service.processWeeklyDigests()
  return { stats, email, prisma }
}

describe('digest pass query budget (AWTD-1454)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('AWTD-1454: a tick with 1,000 users and none due reads no user or settings rows', async () => {
    const { stats, prisma } = await tick(population(1000, 0))

    expect(prisma.user.findMany, 'the User table must not be scanned').not.toHaveBeenCalled()
    expect(stats.rowsRead, stats.log.join('\n')).toBe(0)
    // Daily and weekly: find the unscheduled rows, find the due rows. Nothing else.
    expect(stats.statements, stats.log.join('\n')).toBeLessThanOrEqual(4)
  })

  it('AWTD-1454: the cost of a tick is O(due users), the same at 1,000 users as at 10', async () => {
    const small = await tick(population(10, 3))
    const large = await tick(population(1000, 3))

    expect(large.stats.statements, large.stats.log.join('\n')).toBe(small.stats.statements)
    expect(large.stats.rowsRead, large.stats.log.join('\n')).toBe(small.stats.rowsRead)
    // Per due user: one claim and the three task reads (today, tomorrow, overdue).
    expect(large.stats.statements).toBeLessThanOrEqual(4 + 3 * 4)
    expect(large.email.sendDailyDigest).toHaveBeenCalledTimes(3)
  })
})
