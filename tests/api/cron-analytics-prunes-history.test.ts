/**
 * The nightly analytics cron runs history retention (AWTD-1455) — the wiring is
 * the assertion that matters, as with DeletionLog (AWTD-993): a retention
 * function nobody calls is the bug.
 *
 * `@/lib/history-retention-service` is mocked PARTIALLY, via importOriginal, so
 * its other exports stay real (AWTD-994).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const pruneHistoryTables = vi.fn()
const aggregateDailyStats = vi.fn()
const ensureInitialAdmin = vi.fn()

vi.mock('@/lib/history-retention-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/history-retention-service')>()),
  pruneHistoryTables: (...args: unknown[]) => pruneHistoryTables(...args),
}))
vi.mock('@/lib/analytics-events', () => ({
  aggregateDailyStats: (...args: unknown[]) => aggregateDailyStats(...args),
}))
vi.mock('@/lib/admin-auth', () => ({
  ensureInitialAdmin: (...args: unknown[]) => ensureInitialAdmin(...args),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const { GET } = await import('@/app/api/cron/analytics/route')

const request = (auth?: string) =>
  ({ headers: { get: (k: string) => (k === 'authorization' ? auth ?? null : null) } }) as never

describe('GET /api/cron/analytics runs history retention (AWTD-1455)', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'shhh'
    aggregateDailyStats.mockResolvedValue(undefined)
    ensureInitialAdmin.mockResolvedValue(undefined)
    pruneHistoryTables.mockResolvedValue({ mode: 'dry-run', taskEvents: 1, analyticsEvents: 2, notifications: 3 })
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
  })

  it('runs on an authorised request and reports the counts and mode', async () => {
    const response = await GET(request('Bearer shhh'))
    const body = await response.json()

    expect(pruneHistoryTables).toHaveBeenCalledTimes(1)
    expect(body).toMatchObject({
      historyRetentionMode: 'dry-run',
      taskEventsPruned: 1,
      analyticsEventsPruned: 2,
      notificationsPruned: 3,
    })
  })

  it('aggregates BEFORE it prunes — the rollup reads the raw AnalyticsEvents', async () => {
    await GET(request('Bearer shhh'))

    expect(aggregateDailyStats.mock.invocationCallOrder[0]).toBeLessThan(
      pruneHistoryTables.mock.invocationCallOrder[0],
    )
  })

  it('touches nothing for a caller without the cron secret', async () => {
    const response = await GET(request('Bearer wrong'))

    expect(response.status).toBe(401)
    expect(pruneHistoryTables).not.toHaveBeenCalled()
  })
})
