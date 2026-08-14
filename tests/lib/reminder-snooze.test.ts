/**
 * Task e0613ae5 — first slice of collapsing the duplicated legacy↔v1 routes.
 *
 * `POST /api/reminders/:id/snooze` and `POST /api/v1/reminders/:id/snooze` were
 * two independent implementations of the same ~40 lines: same ownership check,
 * same 5-snooze cap, same scheduledFor arithmetic, same `data` merge. They
 * differed only in how the caller is authenticated and whether the response
 * carries a `meta` envelope.
 *
 * A straight re-export cannot fix that pair — it would either add `meta` to the
 * legacy response or strip it from v1, and both shapes are pinned by contract
 * tests (tests/api/legacy-contract.test.ts, tests/api/v1-contract.test.ts).
 * So the rule moves to lib/ and each route keeps its own auth and its own
 * response shape. That is the pattern the other 27 pairs should follow.
 *
 * These tests are on the extracted rule, because that is where the behaviour
 * now lives — and because a rule with no route around it is far easier to
 * pin down than either handler was.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reminderQueue: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

import { snoozeReminder, MAX_SNOOZE_COUNT } from '@/lib/reminder-snooze'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)

const BASE = {
  id: 'rem-1',
  userId: 'owner-1',
  scheduledFor: new Date('2026-08-13T10:00:00.000Z'),
  retryCount: 0,
  data: {} as Record<string, unknown> | null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-13T09:00:00.000Z'))
  mockPrisma.reminderQueue.findUnique.mockResolvedValue({ ...BASE } as never)
  mockPrisma.reminderQueue.update.mockImplementation((async (args: { data: { scheduledFor: Date } }) => ({
    ...BASE,
    scheduledFor: args.data.scheduledFor,
  })) as never)
})

describe('snoozeReminder (task e0613ae5)', () => {
  it('pushes the reminder out by the requested minutes', async () => {
    const result = await snoozeReminder({ reminderId: 'rem-1', userId: 'owner-1', minutes: 15 })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.scheduledFor.toISOString()).toBe('2026-08-13T09:15:00.000Z')
    expect(result.snoozeCount).toBe(1)
  })

  it('refuses a reminder that does not exist', async () => {
    mockPrisma.reminderQueue.findUnique.mockResolvedValue(null as never)

    const result = await snoozeReminder({ reminderId: 'nope', userId: 'owner-1', minutes: 15 })

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(mockPrisma.reminderQueue.update).not.toHaveBeenCalled()
  })

  it("refuses someone else's reminder", async () => {
    const result = await snoozeReminder({ reminderId: 'rem-1', userId: 'stranger', minutes: 15 })

    expect(result).toMatchObject({ ok: false, status: 403 })
    expect(mockPrisma.reminderQueue.update).not.toHaveBeenCalled()
  })

  it('stops at the snooze cap', async () => {
    mockPrisma.reminderQueue.findUnique.mockResolvedValue({
      ...BASE, data: { snoozeCount: MAX_SNOOZE_COUNT },
    } as never)

    const result = await snoozeReminder({ reminderId: 'rem-1', userId: 'owner-1', minutes: 15 })

    expect(result).toMatchObject({ ok: false, status: 400 })
    if (result.ok) return
    expect(result.error).toMatch(/maximum snooze limit/i)
    expect(mockPrisma.reminderQueue.update).not.toHaveBeenCalled()
  })

  it('preserves the ORIGINAL scheduledFor across repeated snoozes', async () => {
    // The subtle one: `originalScheduledFor` must survive, or the second snooze
    // overwrites it with the already-snoozed time and the record of when the
    // reminder was actually due is lost. Both old implementations had this;
    // it is the kind of detail an extraction quietly drops.
    mockPrisma.reminderQueue.findUnique.mockResolvedValue({
      ...BASE,
      scheduledFor: new Date('2026-08-13T09:15:00.000Z'),
      data: { snoozeCount: 1, originalScheduledFor: '2026-08-13T10:00:00.000Z' },
    } as never)

    await snoozeReminder({ reminderId: 'rem-1', userId: 'owner-1', minutes: 30 })

    const written = mockPrisma.reminderQueue.update.mock.calls[0][0] as unknown as {
      data: { data: Record<string, unknown>; status: string; retryCount: number }
    }
    expect(written.data.data.originalScheduledFor).toBe('2026-08-13T10:00:00.000Z')
    expect(written.data.data.snoozeCount).toBe(2)
    expect(written.data.status).toBe('pending')
    expect(written.data.retryCount).toBe(1)
  })

  it('records the original scheduledFor on the FIRST snooze', async () => {
    await snoozeReminder({ reminderId: 'rem-1', userId: 'owner-1', minutes: 15 })

    const written = mockPrisma.reminderQueue.update.mock.calls[0][0] as unknown as {
      data: { data: Record<string, unknown> }
    }
    expect(written.data.data.originalScheduledFor).toEqual(BASE.scheduledFor)
  })
})
