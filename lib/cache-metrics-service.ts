/**
 * Redis cache metrics — the Prisma half (AWTD-905).
 *
 * Only this file touches the database, so `lib/cache-metrics.ts` stays
 * importable without one and `lib/redis.ts` does not gain a static Prisma
 * dependency (it reaches this module through a dynamic import at flush time).
 * Same arrangement as `lib/web-vitals-service.ts`.
 *
 * ## Everything here refuses rather than throws
 *
 * The write runs on the REQUEST path — a lambda flushes its window inside a
 * `RedisCache.get()` while a user waits — and the prune runs inside the nightly
 * analytics cron. In both places a rejection would be attributed to the wrong
 * thing: a cache lookup failing, or the job that aggregates real usage stats
 * failing. Telemetry must never be able to produce something that reads as an
 * incident, so each function below returns a falsy/empty result and logs.
 */

import { prisma } from './prisma'
import { createLogger } from './logger'
import {
  CACHE_METRICS_RETENTION_DAYS,
  cacheMetricsBucketStart,
  isEmptyCacheMetricWindow,
  summarizeCacheMetrics,
  summarizeCacheMetricsByDay,
  type CacheMetricsDay,
  type CacheMetricsSummary,
  type CacheMetricWindowSample,
} from './cache-metrics'

const log = createLogger('cache-metrics-service')

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Add one flushed window to its hour bucket.
 *
 * An upsert with `increment`, not a read-modify-write: two flushes from the same
 * instance in one hour are two round trips to the same row, and the increment
 * keeps them additive without the service having to hold the previous value.
 */
export async function recordCacheMetricWindow(
  sample: CacheMetricWindowSample,
  { now = new Date() }: { now?: Date } = {},
): Promise<boolean> {
  // An idle window writes nothing, for the reason the log event skips one: an
  // all-zero row per minute per warm lambda changes no sum.
  if (isEmptyCacheMetricWindow(sample)) return false

  const bucketStart = cacheMetricsBucketStart(now)

  try {
    await prisma.cacheMetricBucket.upsert({
      where: { bucketStart_instanceId: { bucketStart, instanceId: sample.instanceId } },
      create: {
        bucketStart,
        instanceId: sample.instanceId,
        hits: sample.hits,
        misses: sample.misses,
        loads: sample.loads,
        coalesced: sample.coalesced,
        errors: sample.errors,
        lookupMsTotal: sample.lookupMs,
        loadMsTotal: sample.loadMs,
        windows: 1,
      },
      update: {
        hits: { increment: sample.hits },
        misses: { increment: sample.misses },
        loads: { increment: sample.loads },
        coalesced: { increment: sample.coalesced },
        errors: { increment: sample.errors },
        lookupMsTotal: { increment: sample.lookupMs },
        loadMsTotal: { increment: sample.loadMs },
        windows: { increment: 1 },
      },
    })
    return true
  } catch (error) {
    log.error({ err: error, instanceId: sample.instanceId }, 'Failed to record cache metrics window')
    return false
  }
}

/**
 * Drop buckets older than the retention period.
 *
 * The `[bucketStart]` index serves this predicate, so it stays a range delete.
 */
export async function pruneCacheMetricBuckets(
  { now = new Date() }: { now?: Date } = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - CACHE_METRICS_RETENTION_DAYS * DAY_MS)

  try {
    const { count } = await prisma.cacheMetricBucket.deleteMany({
      where: { bucketStart: { lt: cutoff } },
    })
    return count
  } catch (error) {
    log.error({ err: error, cutoff }, 'Failed to prune cache metric buckets')
    return 0
  }
}

export interface CacheMetricsReport {
  totals: CacheMetricsSummary
  byDay: CacheMetricsDay[]
  retentionDays: number
}

const emptyReport = (): CacheMetricsReport => ({
  totals: summarizeCacheMetrics([]),
  byDay: [],
  retentionDays: CACHE_METRICS_RETENTION_DAYS,
})

/**
 * The range total plus one row per day, for `/admin/analytics`.
 *
 * Reads the raw buckets and aggregates in memory on purpose: a 90-day range is
 * `90 x 24 x instances` rows, and the distinct-instance count and the
 * divide-once hit rate both need the rows rather than a SQL `SUM`.
 */
export async function getCacheMetricsReport({
  startDate,
  endDate,
}: {
  startDate: Date
  endDate: Date
}): Promise<CacheMetricsReport> {
  try {
    const rows = await prisma.cacheMetricBucket.findMany({
      where: { bucketStart: { gte: startDate, lte: endDate } },
      select: {
        bucketStart: true,
        instanceId: true,
        hits: true,
        misses: true,
        loads: true,
        coalesced: true,
        errors: true,
        lookupMsTotal: true,
        loadMsTotal: true,
        windows: true,
      },
      orderBy: { bucketStart: 'asc' },
    })

    return {
      totals: summarizeCacheMetrics(rows),
      byDay: summarizeCacheMetricsByDay(rows),
      retentionDays: CACHE_METRICS_RETENTION_DAYS,
    }
  } catch (error) {
    // The cache section is a detail on a page whose main job is usage stats. It
    // must not be able to 500 the whole dashboard.
    log.error({ err: error, startDate, endDate }, 'Failed to read cache metric buckets')
    return emptyReport()
  }
}
