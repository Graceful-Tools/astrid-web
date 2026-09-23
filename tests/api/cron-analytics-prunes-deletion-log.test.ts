/**
 * The nightly analytics cron has to be the thing that expires tombstones
 * (AWTD-993).
 *
 * `pruneDeletionLog` had unit tests and no callers for months — `grep -rn
 * "pruneDeletionLog"` over the repo returned exactly one hit, its own
 * definition — so DeletionLog accumulated a row per deleted entity forever and
 * `getDeletionsSince` scanned a table that only ever grew. A retention function
 * nobody calls is the bug, which means the assertion that matters is the
 * WIRING: deleting the call from the cron must turn something red.
 *
 * Mirrors tests/api/cron-analytics-prunes-vitals.test.ts, which pins the same
 * contract for WebVitalSample (AWTD-990) and cited this uncalled function as its
 * reason for existing.
 *
 * `@/lib/deletion-log` is mocked PARTIALLY, via importOriginal. A wholesale
 * factory would leave every other export of that module undefined, which is how
 * AWTD-994 turned an unrelated import-graph change into a suite-wide collection
 * error blaming an innocent file.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const pruneDeletionLog = vi.fn()
const aggregateDailyStats = vi.fn()
const ensureInitialAdmin = vi.fn()

vi.mock('@/lib/deletion-log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/deletion-log')>()),
  pruneDeletionLog: (...args: unknown[]) => pruneDeletionLog(...args),
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

describe('GET /api/cron/analytics prunes the deletion log (AWTD-993)', () => {
  const originalSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'shhh'
    aggregateDailyStats.mockResolvedValue(undefined)
    ensureInitialAdmin.mockResolvedValue(undefined)
    pruneDeletionLog.mockResolvedValue(67)
  })

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret
  })

  it('prunes on an authorised run, and says how many tombstones went', async () => {
    const response = await GET(request('Bearer shhh'))
    const body = await response.json()

    expect(pruneDeletionLog).toHaveBeenCalledTimes(1)
    // runCronJob spreads the job's return value into the response, so the count
    // is queryable from the cron log rather than only visible in a debugger.
    expect(body.deletionTombstonesPruned).toBe(67)
  })

  it('aggregates BEFORE it prunes', async () => {
    // Housekeeping must never be able to cost us the day's aggregation.
    await GET(request('Bearer shhh'))

    expect(aggregateDailyStats.mock.invocationCallOrder[0]).toBeLessThan(
      pruneDeletionLog.mock.invocationCallOrder[0],
    )
  })

  it('deletes nothing for a caller without the cron secret', async () => {
    const response = await GET(request('Bearer wrong'))

    expect(response.status).toBe(401)
    expect(pruneDeletionLog).not.toHaveBeenCalled()
  })

  /**
   * The dangerous direction, asserted rather than commented.
   *
   * A tombstone pruned before a client syncs means that client never learns the
   * row was deleted — a correctness bug, not a size one. The web client forces a
   * FULL sync when no cursor is within `MAX_CURSOR_AGE` (24h, lib/data-sync.ts),
   * so 30 days of retention leaves a 30x margin. If someone ever shortens
   * retention below that validity window, deletions start going silently
   * unnoticed on the clients that sync incrementally, and nothing else here
   * would say so.
   */
  it('keeps tombstones far longer than a sync cursor stays valid', async () => {
    const { DELETION_LOG_RETENTION_DAYS } = await import('@/lib/deletion-log')
    const MAX_CURSOR_AGE_DAYS = 1 // lib/data-sync.ts MAX_CURSOR_AGE = 24h

    expect(DELETION_LOG_RETENTION_DAYS).toBeGreaterThan(MAX_CURSOR_AGE_DAYS)
  })
})
