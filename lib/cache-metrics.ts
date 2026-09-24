/**
 * Redis cache metrics — the pure half (AWTD-905).
 *
 * Bucket boundaries and aggregation, with no Prisma import, so the arithmetic
 * that decides whether the reported hit rate is true can be tested directly.
 * The write path and the read query live in `lib/cache-metrics-service.ts`, the
 * same split as `lib/web-vitals.ts` / `lib/web-vitals-service.ts`.
 *
 * ## Why this exists at all
 *
 * `docs/PERFORMANCE_BUDGETS.md` promises a >= 80% cache hit rate and had never
 * sampled it. `RedisCache` has emitted one `info`-level `Cache metrics window`
 * event per process per minute since 2026-09-12, but `vercel logs` returns
 * exactly 100 rows however wide `--since` is, so the events were real and
 * unreadable. Jon chose the analytics page as the surface, which means these
 * windows land in the app's own database, which has no such ceiling.
 *
 * ## Two rules the arithmetic here exists to enforce
 *
 * **Divide once, at the end.** A bucket that served three lookups and one that
 * served thirty thousand each carry a rate; the mean of those two rates weighs
 * them equally and is not the fleet's hit rate. Every rate below is computed
 * from summed numerators and summed denominators.
 *
 * **Means, not percentiles.** A window arrives as a SUM of durations over a
 * count of operations, and no percentile is recoverable from that. The latency
 * this module reports is a mean and is named for it — the budget document's
 * other latency rows are percentiles, and quietly comparing the two would be
 * worse than having no number.
 */

/** The widest range `/admin/analytics` can ask for (its selector offers 7/30/90). */
export const CACHE_METRICS_MAX_REPORT_DAYS = 90

/**
 * How long a bucket is kept.
 *
 * Deliberately LONGER than the widest report, for the reason
 * `WEB_VITALS_RETENTION_DAYS` is: retention shorter than the window being read
 * is the failure that never announces itself. The oldest end of the chart comes
 * back empty, the range total shifts, and no error is raised anywhere.
 */
export const CACHE_METRICS_RETENTION_DAYS = CACHE_METRICS_MAX_REPORT_DAYS + 7

/** How much wall-clock one process accumulates before it flushes a window. */
export const CACHE_METRICS_WINDOW_MS = 60_000

/** What one flush contributes: deltas for the window, never lifetime totals. */
export interface CacheMetricWindowSample {
  instanceId: string
  hits: number
  misses: number
  loads: number
  coalesced: number
  errors: number
  /** Summed Redis round-trip time over the window's lookups (hits + misses). */
  lookupMs: number
  /** Summed loader time over the window's loads. */
  loadMs: number
}

/** One stored row: an hour of one instance's windows. */
export interface CacheMetricBucketRow {
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
}

export interface CacheMetricsSummary {
  hits: number
  misses: number
  /** hits + misses: the denominator of the hit rate, and of the lookup mean. */
  lookups: number
  loads: number
  coalesced: number
  errors: number
  /** How many flushed windows went into this summary. */
  windows: number
  /** Distinct reporting processes — a fleet of one is a number to distrust. */
  instances: number
  /** Percent, or null when nothing was looked up. Never 0 for "no traffic". */
  hitRate: number | null
  meanLookupMs: number | null
  meanLoadMs: number | null
}

export interface CacheMetricsDay extends CacheMetricsSummary {
  /** UTC day, `YYYY-MM-DD`. */
  date: string
}

/**
 * The hour a flush belongs to.
 *
 * Hourly rather than per-window: the same number of writes either way (one
 * upsert per flush), but the table holds roughly `24 x instances` rows per day
 * instead of `1440 x instances`, so a 90-day read stays cheap. Per-instance
 * rather than global because `instanceId` answers a question the rate alone
 * cannot — whether this is the fleet or one lambda talking to itself.
 */
export function cacheMetricsBucketStart(at: Date): Date {
  const bucket = new Date(at)
  bucket.setUTCMinutes(0, 0, 0)
  return bucket
}

/** Whether a flush has anything in it worth a row. */
export function isEmptyCacheMetricWindow(sample: CacheMetricWindowSample): boolean {
  return (
    sample.hits === 0 &&
    sample.misses === 0 &&
    sample.loads === 0 &&
    sample.coalesced === 0 &&
    sample.errors === 0
  )
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? numerator / denominator : null

export function summarizeCacheMetrics(rows: CacheMetricBucketRow[]): CacheMetricsSummary {
  const totals = {
    hits: 0,
    misses: 0,
    loads: 0,
    coalesced: 0,
    errors: 0,
    windows: 0,
    lookupMsTotal: 0,
    loadMsTotal: 0,
  }
  const instances = new Set<string>()

  for (const row of rows) {
    totals.hits += row.hits
    totals.misses += row.misses
    totals.loads += row.loads
    totals.coalesced += row.coalesced
    totals.errors += row.errors
    totals.windows += row.windows
    totals.lookupMsTotal += row.lookupMsTotal
    totals.loadMsTotal += row.loadMsTotal
    instances.add(row.instanceId)
  }

  const lookups = totals.hits + totals.misses
  const hitRate = ratio(totals.hits, lookups)

  return {
    hits: totals.hits,
    misses: totals.misses,
    lookups,
    loads: totals.loads,
    coalesced: totals.coalesced,
    errors: totals.errors,
    windows: totals.windows,
    instances: instances.size,
    hitRate: hitRate === null ? null : hitRate * 100,
    meanLookupMs: ratio(totals.lookupMsTotal, lookups),
    meanLoadMs: ratio(totals.loadMsTotal, totals.loads),
  }
}

/**
 * One summary per UTC day that reported, in chronological order.
 *
 * A day nothing reported is absent rather than zero-filled: a 0% row would read
 * as a catastrophic cache day, when the fact is that there is no evidence for
 * it. A gap in the chart is the honest shape of a gap in the data.
 */
export function summarizeCacheMetricsByDay(rows: CacheMetricBucketRow[]): CacheMetricsDay[] {
  const byDay = new Map<string, CacheMetricBucketRow[]>()

  for (const row of rows) {
    const date = row.bucketStart.toISOString().slice(0, 10)
    const existing = byDay.get(date)
    if (existing) existing.push(row)
    else byDay.set(date, [row])
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayRows]) => ({ date, ...summarizeCacheMetrics(dayRows) }))
}

/** The shape the page renders when nothing has been recorded yet. */
export function emptyCacheMetricsSummary(): CacheMetricsSummary {
  return summarizeCacheMetrics([])
}

/**
 * An em dash for "nothing was recorded", never a zero.
 *
 * Lives here rather than in the page because it is the rule, not the styling:
 * 0% reads as "the cache missed everything" and 0 ms as "instant", and both are
 * claims this data does not support. The whole reason `hitRate` is nullable is
 * to keep those two states apart, which only holds if every renderer agrees.
 */
export const CACHE_METRIC_NO_DATA = '—'

export function formatCacheHitRate(value: number | null): string {
  return value === null ? CACHE_METRIC_NO_DATA : `${value.toFixed(1)}%`
}

/**
 * Milliseconds, with enough precision to be useful at cache speed.
 *
 * A Redis round trip is often under 10ms, where rounding to the nearest
 * millisecond throws away most of the signal; a loader is hundreds, where two
 * decimal places are noise.
 */
export function formatCacheLatencyMs(value: number | null): string {
  if (value === null) return CACHE_METRIC_NO_DATA
  return `${value < 10 ? value.toFixed(2) : Math.round(value).toLocaleString()} ms`
}
