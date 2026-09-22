/**
 * Core Web Vitals — the Prisma half (AWTD-904).
 *
 * Split from `lib/web-vitals.ts` the same way the legacy-usage census is
 * split: the rules are importable without a database, and only this file
 * touches Prisma. The ingest route and the reporting script both come through
 * here, so there is one definition of what a stored sample looks like.
 */

import { prisma } from './prisma'
import { createLogger } from './logger'
import {
  isPlausibleSample,
  isWebVitalMetric,
  rateWebVital,
  summarizeWebVitals,
  WEB_VITALS_RETENTION_DAYS,
  WEB_VITALS_WINDOW_DAYS,
  type WebVitalSummary,
} from './web-vitals'

const log = createLogger('web-vitals-service')

const DAY_MS = 24 * 60 * 60 * 1000

export interface IncomingWebVital {
  metric: string
  value: number
  route: string
  platform: string
  authState: string
  sessionId: string
}

/**
 * Store one sample, or decline it.
 *
 * Returns false rather than throwing for a sample that fails validation: the
 * caller is a fire-and-forget beacon, and telemetry must never be able to
 * produce an error that looks like a real incident.
 */
export async function recordWebVitalSample(sample: IncomingWebVital): Promise<boolean> {
  if (!isWebVitalMetric(sample.metric)) return false
  if (!isPlausibleSample(sample.metric, sample.value)) return false

  await prisma.webVitalSample.create({
    data: {
      metric: sample.metric,
      value: sample.value,
      // Derived here, never taken from the client: a rating the browser sent
      // could disagree with the thresholds this codebase reports against.
      rating: rateWebVital(sample.metric, sample.value),
      route: sample.route,
      platform: sample.platform,
      authState: sample.authState,
      sessionId: sample.sessionId,
    },
  })
  return true
}

export interface WebVitalsReport {
  windowDays: number
  since: string
  totalSamples: number
  metrics: WebVitalSummary[]
  routes: Array<{ route: string; samples: number }>
}

/**
 * Drop samples older than the retention period (AWTD-990).
 *
 * `WEB_VITALS_RETENTION_DAYS` is longer than the report window on purpose —
 * see the constant. The `[createdAt]` index on WebVitalSample serves this
 * predicate, so it stays a range delete rather than a seq scan.
 *
 * Returns 0 rather than throwing, for the reason `recordWebVitalSample`
 * declines rather than throws: this runs inside the nightly analytics cron, and
 * a telemetry housekeeping failure must not fail the job that aggregates real
 * usage stats — nor page anyone as though it were an incident.
 */
export async function pruneWebVitalSamples(
  { now = new Date() }: { now?: Date } = {},
): Promise<number> {
  const cutoff = new Date(now.getTime() - WEB_VITALS_RETENTION_DAYS * DAY_MS)

  try {
    const { count } = await prisma.webVitalSample.deleteMany({
      where: { createdAt: { lt: cutoff } },
    })
    return count
  } catch (error) {
    log.error({ err: error, cutoff }, 'Failed to prune web vital samples')
    return 0
  }
}

/**
 * The p75 report for the budget document.
 *
 * The default window is `WEB_VITALS_WINDOW_DAYS`, shared with the retention
 * period so the two can never drift into the arrangement where we delete
 * samples this report still reads.
 */
export async function getWebVitalsReport({
  windowDays = WEB_VITALS_WINDOW_DAYS,
}: { windowDays?: number } = {}): Promise<WebVitalsReport> {
  const since = new Date(Date.now() - windowDays * DAY_MS)

  const rows = await prisma.webVitalSample.findMany({
    where: { createdAt: { gte: since } },
    select: { metric: true, value: true, authState: true, route: true },
  })

  const byRoute = new Map<string, number>()
  for (const row of rows) {
    byRoute.set(row.route, (byRoute.get(row.route) ?? 0) + 1)
  }

  return {
    windowDays,
    since: since.toISOString(),
    totalSamples: rows.length,
    metrics: summarizeWebVitals(rows),
    routes: [...byRoute.entries()]
      .map(([route, samples]) => ({ route, samples }))
      .sort((a, b) => b.samples - a.samples),
  }
}
