/**
 * Cache metrics persistence and retention (AWTD-905).
 *
 * The write path runs on the REQUEST path — a lambda serving `GET /api/v1/tasks`
 * flushes its window while a user waits — so the properties that matter here
 * are about what happens when it goes wrong. A telemetry insert must never be
 * able to turn a cache lookup into an error, and the nightly prune must never
 * be able to fail the job that aggregates real usage stats.
 *
 * The retention invariant is the one borrowed wholesale from
 * `tests/lib/web-vitals-retention.test.ts`: retention shorter than the window
 * the page reads is the failure that does not announce itself.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const upsert = vi.fn()
const deleteMany = vi.fn()
const findMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    cacheMetricBucket: {
      upsert: (...a: unknown[]) => upsert(...a),
      deleteMany: (...a: unknown[]) => deleteMany(...a),
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}))

const { recordCacheMetricWindow, pruneCacheMetricBuckets, getCacheMetricsReport } = await import(
  '@/lib/cache-metrics-service'
)
const { CACHE_METRICS_RETENTION_DAYS, CACHE_METRICS_MAX_REPORT_DAYS } = await import(
  '@/lib/cache-metrics'
)

const DAY_MS = 24 * 60 * 60 * 1000

const sample = (overrides: Record<string, unknown> = {}) => ({
  instanceId: 'dpl_a-1111',
  hits: 7,
  misses: 3,
  loads: 2,
  coalesced: 1,
  errors: 0,
  lookupMs: 42.5,
  loadMs: 310.25,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  upsert.mockResolvedValue({})
  deleteMany.mockResolvedValue({ count: 0 })
  findMany.mockResolvedValue([])
})

describe('recordCacheMetricWindow (AWTD-905)', () => {
  it('increments the hour bucket for this instance instead of inserting a row per window', async () => {
    // One row per instance per HOUR, not per minute: same number of writes
    // either way, but the table stays at 24 x instances rows a day instead of
    // 1440 x instances, and a 90-day read stays small.
    await recordCacheMetricWindow(sample(), { now: new Date('2026-09-22T10:37:00Z') })

    expect(upsert).toHaveBeenCalledTimes(1)
    const call = upsert.mock.calls[0][0]
    expect(call.where).toEqual({
      bucketStart_instanceId: {
        bucketStart: new Date('2026-09-22T10:00:00.000Z'),
        instanceId: 'dpl_a-1111',
      },
    })
    expect(call.update).toMatchObject({
      hits: { increment: 7 },
      misses: { increment: 3 },
      loads: { increment: 2 },
      coalesced: { increment: 1 },
      errors: { increment: 0 },
      lookupMsTotal: { increment: 42.5 },
      loadMsTotal: { increment: 310.25 },
      windows: { increment: 1 },
    })
  })

  it('creates the bucket with the window as its first contribution', async () => {
    await recordCacheMetricWindow(sample(), { now: new Date('2026-09-22T10:37:00Z') })

    expect(upsert.mock.calls[0][0].create).toMatchObject({
      bucketStart: new Date('2026-09-22T10:00:00.000Z'),
      instanceId: 'dpl_a-1111',
      hits: 7,
      misses: 3,
      lookupMsTotal: 42.5,
      loadMsTotal: 310.25,
      windows: 1,
    })
  })

  it('returns false instead of throwing when the write fails', async () => {
    // This runs inside RedisCache.get(). A rejection here would surface as a
    // failed cache lookup — telemetry turning itself into an incident.
    upsert.mockRejectedValue(new Error('connection terminated'))

    await expect(
      recordCacheMetricWindow(sample(), { now: new Date() }),
    ).resolves.toBe(false)
  })

  it('declines a window with nothing in it rather than writing an all-zero row', async () => {
    const written = await recordCacheMetricWindow(
      sample({ hits: 0, misses: 0, loads: 0, coalesced: 0, errors: 0, lookupMs: 0, loadMs: 0 }),
      { now: new Date() },
    )

    expect(written).toBe(false)
    expect(upsert).not.toHaveBeenCalled()
  })
})

describe('cache metrics retention (AWTD-905)', () => {
  it('keeps at least as much history as the page can ask for', () => {
    // The range selector offers 90 days. Retention below that truncates the
    // oldest end of the chart with nothing anywhere saying why.
    expect(CACHE_METRICS_RETENTION_DAYS).toBeGreaterThanOrEqual(CACHE_METRICS_MAX_REPORT_DAYS)
  })

  it('deletes only buckets older than the retention period', async () => {
    const now = new Date('2026-09-22T08:00:00Z')

    await pruneCacheMetricBuckets({ now })

    expect(deleteMany).toHaveBeenCalledTimes(1)
    expect(deleteMany.mock.calls[0][0].where.bucketStart.lt).toEqual(
      new Date(now.getTime() - CACHE_METRICS_RETENTION_DAYS * DAY_MS),
    )
  })

  it('reports how many rows it removed', async () => {
    deleteMany.mockResolvedValue({ count: 312 })
    expect(await pruneCacheMetricBuckets({ now: new Date() })).toBe(312)
  })

  it('returns 0 instead of throwing when the delete fails', async () => {
    deleteMany.mockRejectedValue(new Error('connection terminated'))
    await expect(pruneCacheMetricBuckets({ now: new Date() })).resolves.toBe(0)
  })
})

describe('getCacheMetricsReport (AWTD-905)', () => {
  it('reads the buckets overlapping the requested range and summarizes them', async () => {
    findMany.mockResolvedValue([
      {
        bucketStart: new Date('2026-09-22T10:00:00Z'),
        instanceId: 'dpl_a-1111',
        hits: 8,
        misses: 2,
        loads: 2,
        coalesced: 0,
        errors: 0,
        lookupMsTotal: 20,
        loadMsTotal: 400,
        windows: 4,
      },
    ])

    const report = await getCacheMetricsReport({
      startDate: new Date('2026-09-22T00:00:00Z'),
      endDate: new Date('2026-09-22T23:59:59.999Z'),
    })

    expect(findMany.mock.calls[0][0].where.bucketStart).toEqual({
      gte: new Date('2026-09-22T00:00:00Z'),
      lte: new Date('2026-09-22T23:59:59.999Z'),
    })
    expect(report.totals).toMatchObject({ hits: 8, misses: 2, lookups: 10, instances: 1 })
    expect(report.totals.hitRate).toBeCloseTo(80, 5)
    expect(report.totals.meanLookupMs).toBeCloseTo(2, 5)
    expect(report.totals.meanLoadMs).toBeCloseTo(200, 5)
    expect(report.byDay).toHaveLength(1)
    expect(report.byDay[0].date).toBe('2026-09-22')
  })

  it('answers an empty range with an empty report rather than null', async () => {
    const report = await getCacheMetricsReport({
      startDate: new Date('2026-09-01T00:00:00Z'),
      endDate: new Date('2026-09-02T00:00:00Z'),
    })

    // The page has to be able to tell "nothing has been recorded yet" from "the
    // section failed to load", so the shape is always there.
    expect(report.byDay).toEqual([])
    expect(report.totals.hitRate).toBeNull()
    expect(report.retentionDays).toBe(CACHE_METRICS_RETENTION_DAYS)
  })

  it('returns an empty report instead of throwing when the read fails', async () => {
    // The cache section must not be able to 500 the whole analytics page.
    findMany.mockRejectedValue(new Error('connection terminated'))

    const report = await getCacheMetricsReport({
      startDate: new Date('2026-09-01T00:00:00Z'),
      endDate: new Date('2026-09-02T00:00:00Z'),
    })

    expect(report.byDay).toEqual([])
    expect(report.totals.lookups).toBe(0)
  })
})
