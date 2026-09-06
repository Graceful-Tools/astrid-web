/**
 * RED for task 134bf288.
 *
 * processDueReminders fetched EVERY due reminder with a deep include and
 * processed them one at a time, marking each 'sent' only AFTER the email and
 * push had gone out. After any outage the backlog exceeds the function's time
 * limit, the invocation is killed part-way through, and every reminder already
 * delivered is still 'pending' — so the next minute re-sends them, and the
 * minute after that. This matters right now because the cron has not run since
 * 2026-08-19, so the first successful run meets a multi-week backlog.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReminderService } from '@/lib/reminder-service'

const findMany = vi.fn()
const updateMany = vi.fn()
const update = vi.fn()
const settingsFindUnique = vi.fn()

const prisma = {
  reminderQueue: { findMany, updateMany, update },
  reminderSettings: { findUnique: settingsFindUnique },
  task: { update: vi.fn() },
} as never

const emailService = { sendTaskReminder: vi.fn() } as never
const pushService = { sendTaskReminder: vi.fn() } as never

function reminder(id: string) {
  return {
    id,
    userId: 'u1',
    retryCount: 0,
    data: {},
    task: { id: 't1', dueDateTime: null, reminderType: 'both', lists: [] },
    user: { email: 'u@e.test', name: 'U' },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  updateMany.mockResolvedValue({ count: 0 })
  update.mockResolvedValue({})
  settingsFindUnique.mockResolvedValue(null)
  findMany.mockResolvedValue([])
})

describe('processDueReminders', () => {
  it('bounds the batch instead of loading the whole backlog', async () => {
    const service = new ReminderService(prisma, emailService, pushService)

    await service.processDueReminders()

    const query = findMany.mock.calls.at(-1)![0]
    expect(query.take).toBeGreaterThan(0)
    expect(query.orderBy).toEqual({ scheduledFor: 'asc' })
  })

  it('claims a reminder before sending, conditionally on it still being pending', async () => {
    findMany.mockResolvedValue([reminder('r1')])
    // The claim succeeds.
    updateMany.mockImplementation(async (args: never) => {
      const a = args as unknown as { where: { status?: string } }
      return { count: a.where.status === 'pending' ? 1 : 0 }
    })
    const service = new ReminderService(prisma, emailService, pushService)

    await service.processDueReminders()

    const claim = updateMany.mock.calls.find(
      c => (c[0] as { data?: { status?: string } }).data?.status === 'sending',
    )
    expect(claim).toBeDefined()
    expect((claim![0] as { where: unknown }).where).toMatchObject({ id: 'r1', status: 'pending' })
  })

  it('skips a reminder another run already claimed', async () => {
    findMany.mockResolvedValue([reminder('r1')])
    updateMany.mockResolvedValue({ count: 0 }) // lost the race
    const service = new ReminderService(prisma, emailService, pushService)

    await service.processDueReminders()

    // No delivery, and no settings lookup — it never entered processing.
    expect(settingsFindUnique).not.toHaveBeenCalled()
  })

  it('returns reminders stuck mid-delivery to the queue', async () => {
    const service = new ReminderService(prisma, emailService, pushService)

    await service.processDueReminders()

    const release = updateMany.mock.calls.find(
      c => (c[0] as { where?: { status?: string } }).where?.status === 'sending',
    )
    expect(release).toBeDefined()
    expect((release![0] as { data: unknown }).data).toEqual({ status: 'pending' })
  })
})
