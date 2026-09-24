/**
 * Cache metrics aggregation — the pure half (AWTD-905).
 *
 * The task's whole history is a series of numbers that would have looked right
 * and been wrong, so these tests pin the arithmetic rather than the plumbing.
 *
 * Two mistakes are specifically guarded here:
 *
 *   - **Averaging rates.** A bucket that served three lookups and one that
 *     served thirty thousand each carry one `hitRate`; taking the mean of those
 *     weighs them equally. The fleet rate has to divide ONCE, at the end, out
 *     of summed hits and summed lookups.
 *   - **Implying percentiles.** Windows arrive as sums, and a p75 is not
 *     recoverable from a sum. What the buckets can honestly answer is a MEAN
 *     latency per period, and the field names have to say so.
 */

import { describe, expect, it } from 'vitest'

const {
  summarizeCacheMetrics,
  summarizeCacheMetricsByDay,
  cacheMetricsBucketStart,
  formatCacheHitRate,
  formatCacheLatencyMs,
  CACHE_METRIC_NO_DATA,
} = await import('@/lib/cache-metrics')

const bucket = (
  overrides: Partial<{
    bucketStart: Date
    instanceId: string
    hits: number
    misses: number
    loads: number
    coalesced: number
    errors: number
    lookupMsTotal: number
    loadMsTotal: number
    windows: number
  }> = {},
) => ({
  bucketStart: new Date('2026-09-22T10:00:00Z'),
  instanceId: 'dpl_a-1111',
  hits: 0,
  misses: 0,
  loads: 0,
  coalesced: 0,
  errors: 0,
  lookupMsTotal: 0,
  loadMsTotal: 0,
  windows: 1,
  ...overrides,
})

describe('cacheMetricsBucketStart (AWTD-905)', () => {
  it('floors to the UTC hour', () => {
    expect(cacheMetricsBucketStart(new Date('2026-09-22T10:37:41.512Z'))).toEqual(
      new Date('2026-09-22T10:00:00.000Z'),
    )
  })

  it('is stable across a whole hour, so every flush in it lands on one row', () => {
    const first = cacheMetricsBucketStart(new Date('2026-09-22T10:00:00.000Z'))
    const last = cacheMetricsBucketStart(new Date('2026-09-22T10:59:59.999Z'))
    expect(last).toEqual(first)
  })
})

describe('summarizeCacheMetrics (AWTD-905)', () => {
  it('divides once, out of summed hits and lookups, rather than averaging the per-bucket rates', () => {
    const rows = [
      // 100% of 3 lookups.
      bucket({ hits: 3, misses: 0 }),
      // 50% of 30,000 lookups. The honest fleet rate is 15003/30003 ≈ 50.0%;
      // averaging the two rates would report 75%.
      bucket({ instanceId: 'dpl_a-2222', hits: 15_000, misses: 15_000 }),
    ]

    const summary = summarizeCacheMetrics(rows)

    expect(summary.hits).toBe(15_003)
    expect(summary.misses).toBe(15_000)
    expect(summary.lookups).toBe(30_003)
    expect(summary.hitRate).toBeCloseTo(50.005, 2)
  })

  it('reports a null hit rate for a period with no lookups, never 0%', () => {
    // 0% reads as "the cache missed everything", which is a different fact from
    // "nothing asked it anything".
    const summary = summarizeCacheMetrics([bucket({ errors: 2 })])
    expect(summary.lookups).toBe(0)
    expect(summary.hitRate).toBeNull()
  })

  it('reports an empty period as empty rather than throwing', () => {
    const summary = summarizeCacheMetrics([])
    expect(summary).toMatchObject({ hits: 0, misses: 0, lookups: 0, hitRate: null, instances: 0 })
    expect(summary.meanLookupMs).toBeNull()
    expect(summary.meanLoadMs).toBeNull()
  })

  it('means latency over the operations that produced it, not over the buckets', () => {
    const rows = [
      // 2 lookups totalling 10ms, and 1 load totalling 300ms.
      bucket({ hits: 2, lookupMsTotal: 10, loads: 1, loadMsTotal: 300 }),
      // 8 lookups totalling 10ms, and 3 loads totalling 300ms.
      bucket({ instanceId: 'dpl_a-2222', hits: 6, misses: 2, lookupMsTotal: 10, loads: 3, loadMsTotal: 300 }),
    ]

    const summary = summarizeCacheMetrics(rows)

    // 20ms over 10 lookups. Averaging the two buckets' own means (5ms, 1.25ms)
    // would say 3.125ms.
    expect(summary.meanLookupMs).toBeCloseTo(2, 5)
    // 600ms over 4 loads.
    expect(summary.meanLoadMs).toBeCloseTo(150, 5)
  })

  it('counts the instances that reported, so a fleet of one cannot pass as a fleet', () => {
    const rows = [
      bucket({ hits: 1 }),
      bucket({ hits: 1, bucketStart: new Date('2026-09-22T11:00:00Z') }),
      bucket({ hits: 1, instanceId: 'dpl_a-2222' }),
    ]

    // Three rows, two instances: the same instance reporting in two hours is
    // one instance. This is the check `instanceId` was added for — a number
    // aggregated from a single lambda is not the fleet's hit rate.
    expect(summarizeCacheMetrics(rows).instances).toBe(2)
  })

  it('carries the coalesced, error and load counts through untouched', () => {
    const summary = summarizeCacheMetrics([
      bucket({ loads: 2, coalesced: 5, errors: 1, windows: 3 }),
      bucket({ instanceId: 'dpl_a-2222', loads: 1, coalesced: 0, errors: 2, windows: 4 }),
    ])

    expect(summary).toMatchObject({ loads: 3, coalesced: 5, errors: 3, windows: 7 })
  })
})

describe('rendering a metric that may not exist (AWTD-905)', () => {
  it('renders no data as no number, never as zero', () => {
    // The whole point of a nullable hitRate is that "nothing was recorded" and
    // "everything missed" are different facts. A renderer that prints 0% for
    // null throws that distinction away at the last step.
    expect(formatCacheHitRate(null)).toBe(CACHE_METRIC_NO_DATA)
    expect(formatCacheLatencyMs(null)).toBe(CACHE_METRIC_NO_DATA)
    expect(formatCacheHitRate(0)).toBe('0.0%')
    expect(formatCacheLatencyMs(0)).toBe('0.00 ms')
  })

  it('keeps sub-millisecond precision where a cache lookup lives', () => {
    // Rounding 2.4ms to 2ms throws away most of the signal in the number the
    // budget cares about; doing the same to a 312ms loader adds none.
    expect(formatCacheLatencyMs(2.436)).toBe('2.44 ms')
    expect(formatCacheLatencyMs(312.4)).toBe('312 ms')
  })
})

describe('summarizeCacheMetricsByDay (AWTD-905)', () => {
  it('groups buckets into UTC days and summarizes each one independently', () => {
    const days = summarizeCacheMetricsByDay([
      bucket({ bucketStart: new Date('2026-09-22T10:00:00Z'), hits: 8, misses: 2, lookupMsTotal: 20 }),
      bucket({ bucketStart: new Date('2026-09-22T23:00:00Z'), hits: 2, misses: 8, lookupMsTotal: 30 }),
      bucket({ bucketStart: new Date('2026-09-23T00:00:00Z'), hits: 9, misses: 1 }),
    ])

    expect(days.map(d => d.date)).toEqual(['2026-09-22', '2026-09-23'])
    // 10 hits of 20 lookups on the 22nd — not the mean of 80% and 20%, which
        // would coincidentally agree here, so the latency check below is the one
    // that actually separates the two implementations.
    expect(days[0].hitRate).toBeCloseTo(50, 5)
    expect(days[0].meanLookupMs).toBeCloseTo(2.5, 5)
    expect(days[1].hitRate).toBeCloseTo(90, 5)
  })

  it('returns the days in chronological order whatever order the rows arrive in', () => {
    const days = summarizeCacheMetricsByDay([
      bucket({ bucketStart: new Date('2026-09-24T05:00:00Z'), hits: 1 }),
      bucket({ bucketStart: new Date('2026-09-22T05:00:00Z'), hits: 1 }),
      bucket({ bucketStart: new Date('2026-09-23T05:00:00Z'), hits: 1 }),
    ])

    expect(days.map(d => d.date)).toEqual(['2026-09-22', '2026-09-23', '2026-09-24'])
  })

  it('omits a day nothing reported rather than inventing a zero row', () => {
    // A gap in the chart is a gap in the evidence. A 0% row would read as a
    // catastrophic cache day.
    const days = summarizeCacheMetricsByDay([
      bucket({ bucketStart: new Date('2026-09-22T05:00:00Z'), hits: 1 }),
      bucket({ bucketStart: new Date('2026-09-24T05:00:00Z'), hits: 1 }),
    ])

    expect(days.map(d => d.date)).toEqual(['2026-09-22', '2026-09-24'])
  })
})
