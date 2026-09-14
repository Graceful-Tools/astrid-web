/**
 * RED for task 8f719931.
 *
 * The platform buckets were a hand-written subset that omitted 'mac-app', while
 * the write reads usersByPlatform['mac-app'].size. Both argument objects for
 * the upsert are built eagerly, so aggregateDailyStats threw a TypeError on
 * EVERY call: /api/cron/analytics has been failing since the Mac platform was
 * added and no AnalyticsDailyStats row has been written at all. It is currently
 * masked by the cron routes 401ing for a missing CRON_SECRET, and would surface
 * the moment that is fixed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findMany = vi.hoisted(() => vi.fn())
const upsert = vi.hoisted(() => vi.fn())
const count = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({
  prisma: {
    analyticsEvent: { findMany, count },
    analyticsDailyStats: { upsert },
  },
}))

const { aggregateDailyStats, AnalyticsPlatform } = await import('@/lib/analytics-events')

function event(platform: string, userId: string) {
  return { userId, platform, eventType: 'task_created' }
}

beforeEach(() => {
  vi.clearAllMocks()
  upsert.mockResolvedValue({})
  count.mockResolvedValue(0)
})

describe('aggregateDailyStats', () => {
  it('does not throw on a mac-app event, and counts it', async () => {
    findMany.mockResolvedValue([event(AnalyticsPlatform.MAC_APP, 'u1')])

    await expect(aggregateDailyStats(new Date('2026-09-05'))).resolves.not.toThrow()

    expect(upsert).toHaveBeenCalled()
    expect(upsert.mock.calls[0][0].create.dauMacApp).toBe(1)
  })

  it('has a bucket for every declared platform', async () => {
    findMany.mockResolvedValue(
      Object.values(AnalyticsPlatform).map((p, i) => event(p, `u${i}`)),
    )

    await expect(aggregateDailyStats(new Date('2026-09-05'))).resolves.not.toThrow()

    const created = upsert.mock.calls[0][0].create
    expect(created.dauWebDesktop).toBe(1)
    expect(created.dauIOSApp).toBe(1)
    expect(created.dauMacApp).toBe(1)
    expect(created.dauUnknown).toBe(1)
  })

  it('counts an unrecognised platform as unknown rather than dropping it', async () => {
    findMany.mockResolvedValue([event('some-future-client', 'u1')])

    await aggregateDailyStats(new Date('2026-09-05'))

    expect(upsert.mock.calls[0][0].create.dauUnknown).toBe(1)
  })
})

/**
 * AWTD-859 — re-aggregating a day that already has a row must refresh EVERY
 * column, not just the ones someone remembered.
 *
 * `dauMacApp` was added to the upsert's `create` branch and not to `update`
 * (the Mac platform landed in e060e91). Nothing caught it because every case
 * above asserts on `create` only.
 *
 * The consequence is narrow and nasty. The nightly cron aggregates a fresh day,
 * so `create` wins and Mac numbers look right. But ANY re-aggregation of an
 * existing day takes the `update` path, where `dauMacApp` is simply absent —
 * so the column keeps whatever it was first written with. For a row created
 * before the Mac platform existed that is the schema default, 0, and it stays 0
 * however many times the day is rebuilt. That silently breaks the "safe to
 * repeat" property scripts/reaggregate-analytics.ts is built on, for the one
 * column the repair was for.
 *
 * Asserted as a set comparison rather than one `dauMacApp` case: the next
 * column added to `create` alone should fail here too.
 */
describe('aggregateDailyStats upsert symmetry (AWTD-859)', () => {
  it('updates every column it creates, so rebuilding a day cannot leave one stale', async () => {
    findMany.mockResolvedValue(
      Object.values(AnalyticsPlatform).map((p, i) => event(p, `u${i}`)),
    )

    await aggregateDailyStats(new Date('2026-09-05'))

    const { create, update } = upsert.mock.calls[0][0]
    // `date` is the conflict key — it identifies the row and is never updated.
    const createdColumns = Object.keys(create).filter((column) => column !== 'date')
    const updatedColumns = Object.keys(update)

    expect(updatedColumns.sort()).toEqual(createdColumns.sort())
  })

  it('refreshes dauMacApp on a rebuild rather than leaving the first value', async () => {
    findMany.mockResolvedValue([event(AnalyticsPlatform.MAC_APP, 'u1')])

    await aggregateDailyStats(new Date('2026-09-05'))

    expect(upsert.mock.calls[0][0].update.dauMacApp).toBe(1)
  })
})
