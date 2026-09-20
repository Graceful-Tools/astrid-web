/**
 * Core Web Vitals — the Prisma half (AWTD-904).
 *
 * Split from `lib/web-vitals.ts` the same way the legacy-usage census is
 * split: the rules are importable without a database, and only this file
 * touches Prisma. The ingest route and the reporting script both come through
 * here, so there is one definition of what a stored sample looks like.
 */

import { prisma } from './prisma'
import {
  isPlausibleSample,
  isWebVitalMetric,
  rateWebVital,
  summarizeWebVitals,
  type WebVitalSummary,
} from './web-vitals'

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
 * The p75 report for the budget document.
 *
 * Defaults to 28 days, matching both the Speed Insights dashboard window and
 * the observation window the legacy-API census uses, so the two numbers in
 * PERFORMANCE_BUDGETS.md are over comparable periods.
 */
export async function getWebVitalsReport({ windowDays = 28 }: { windowDays?: number } = {}): Promise<WebVitalsReport> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)

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
