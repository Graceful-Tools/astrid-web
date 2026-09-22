/**
 * The nightly analytics cron has to be the thing that expires telemetry
 * (AWTD-990).
 *
 * `pruneWebVitalSamples` has its own unit tests, but a retention function
 * nobody calls is exactly the bug this task is about — `pruneDeletionLog` in
 * lib/deletion-log.ts has been written, tested and uncalled for months. So the
 * assertion that matters is the wiring: deleting the call from the cron must
 * turn something red.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const pruneWebVitalSamples = vi.fn()
const aggregateDailyStats = vi.fn()
const ensureInitialAdmin = vi.fn()

vi.mock('@/lib/web-vitals-service', () => ({
  pruneWebVitalSamples: (...args: unknown[]) => pruneWebVitalSamples(...args),
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

describe('GET /api/cron/analytics prunes web vital samples (AWTD-990)', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'shhh'
    aggregateDailyStats.mockResolvedValue(undefined)
    ensureInitialAdmin.mockResolvedValue(undefined)
    pruneWebVitalSamples.mockResolvedValue(12)
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
  })

  it('prunes on an authorised run, and says how many rows went', async () => {
    const response = await GET(request('Bearer shhh'))
    const body = await response.json()

    expect(pruneWebVitalSamples).toHaveBeenCalledTimes(1)
    // runCronJob spreads the job's return value into the response, so the count
    // is queryable from the cron log rather than only visible in a debugger.
    expect(body.webVitalSamplesPruned).toBe(12)
  })

  it('aggregates BEFORE it prunes', async () => {
    // Housekeeping must never be able to cost us the day's aggregation.
    await GET(request('Bearer shhh'))

    expect(aggregateDailyStats.mock.invocationCallOrder[0]).toBeLessThan(
      pruneWebVitalSamples.mock.invocationCallOrder[0],
    )
  })

  it('deletes nothing for a caller without the cron secret', async () => {
    const response = await GET(request('Bearer wrong'))

    expect(response.status).toBe(401)
    expect(pruneWebVitalSamples).not.toHaveBeenCalled()
  })
})
