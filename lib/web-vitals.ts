/**
 * Core Web Vitals — the pure half (AWTD-904).
 *
 * Thresholds, bucketing and the p75 aggregation, with no Prisma and no
 * `next/server` import, so both the ingest route and the reporting script can
 * use one copy of the rules and the tests can exercise them directly.
 *
 * Deliberately NOT here: the write path (`lib/web-vitals-service.ts`) and the
 * client reporter (`components/web-vitals-reporter.tsx`). This file
 * is the same shape as `lib/legacy-api-usage.ts` for the same reason — the
 * rules are worth testing without a database.
 *
 * ## Why p75 and not the p50/p95 used elsewhere in PERFORMANCE_BUDGETS.md
 *
 * LCP, INP and CLS are *defined* by Google at the 75th percentile: a page
 * "passes" when 75% of visits are under the threshold. Reporting a p50 or p95
 * against Google's numbers would compare two different statistics and quietly
 * mean something other than pass/fail. The local convention loses here.
 */

import { normalizeLegacyRoute } from './legacy-api-usage'

/**
 * How far back the p75 report reads.
 *
 * 28 days, matching both the Speed Insights dashboard window and
 * `REQUIRED_OBSERVATION_DAYS` in the legacy-API census, so the two numbers in
 * PERFORMANCE_BUDGETS.md are over comparable periods.
 */
export const WEB_VITALS_WINDOW_DAYS = 28

/**
 * How long a sample is kept (AWTD-990).
 *
 * Nothing deleted samples at all before this, so the table grew forever and
 * every future migration of it seq-scanned history nobody reads.
 *
 * It is deliberately LONGER than the report window rather than equal to it.
 * Retention shorter than the window is the failure that does not announce
 * itself: the oldest days come back half-empty, the p75 shifts, and no error
 * is raised anywhere. The week of slack means the 28th day is always complete
 * even when the prune runs hours before the report, and the window can widen a
 * little without a gap appearing in the data first.
 */
export const WEB_VITALS_RETENTION_DAYS = WEB_VITALS_WINDOW_DAYS + 7

/** The three metrics the budget document tracks. */
export const WEB_VITAL_METRICS = ['LCP', 'INP', 'CLS'] as const
export type WebVitalMetric = (typeof WEB_VITAL_METRICS)[number]

export function isWebVitalMetric(value: string): value is WebVitalMetric {
  return (WEB_VITAL_METRICS as readonly string[]).includes(value)
}

/**
 * Whether the visit was signed in, stored instead of a user id.
 *
 * The acceptance criterion is that vitals are observable for anonymous AND
 * signed-in sessions. That needs the distinction, not the identity — so this
 * is the only thing recorded about who the visitor was, and it is why this
 * table exists rather than a nullable column on `AnalyticsEvent`.
 */
export const AUTH_STATES = ['anonymous', 'signed-in'] as const
export type AuthState = (typeof AUTH_STATES)[number]

export function isAuthState(value: string): value is AuthState {
  return (AUTH_STATES as readonly string[]).includes(value)
}

/**
 * Google's p75 thresholds. `good` is the budget; above `poor` is failing.
 * LCP/INP are milliseconds, CLS is a unitless ratio.
 */
export const WEB_VITAL_THRESHOLDS: Record<WebVitalMetric, { good: number; poor: number; unit: 'ms' | 'ratio' }> = {
  LCP: { good: 2500, poor: 4000, unit: 'ms' },
  INP: { good: 200, poor: 500, unit: 'ms' },
  CLS: { good: 0.1, poor: 0.25, unit: 'ratio' },
}

export type WebVitalRating = 'good' | 'needs-improvement' | 'poor'

export function rateWebVital(metric: WebVitalMetric, value: number): WebVitalRating {
  const { good, poor } = WEB_VITAL_THRESHOLDS[metric]
  if (value <= good) return 'good'
  if (value <= poor) return 'needs-improvement'
  return 'poor'
}

/**
 * Upper bounds for a plausible sample, used to drop garbage before it reaches
 * the table. A beacon is unauthenticated, so anyone can post to it; these
 * caps mean the worst a forged sample can do is be wrong, not skew the p75
 * with a value of 1e308.
 */
export const WEB_VITAL_MAX_VALUE: Record<WebVitalMetric, number> = {
  LCP: 120_000,
  INP: 120_000,
  CLS: 100,
}

export function isPlausibleSample(metric: WebVitalMetric, value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= WEB_VITAL_MAX_VALUE[metric]
}

/**
 * Collapse ids out of a page path so a route is one row rather than thousands.
 *
 * Reuses the API normaliser — the rule ("a uuid/cuid/numeric segment is an
 * id") is identical, and a second copy would be a second thing to keep right.
 * The locale prefix goes too: `/en/lists/<id>` and `/fr/lists/<id>` are the
 * same page as far as a performance budget is concerned.
 */
const LOCALE_SEGMENT = /^[a-z]{2}(-[A-Za-z0-9]+)?$/

export function normalizeVitalsRoute(pathname: string): string {
  const collapsed = normalizeLegacyRoute(pathname)
  const segments = collapsed.split('/')
  // segments[0] is '' for a leading slash, so the locale is segments[1].
  if (segments.length > 2 && LOCALE_SEGMENT.test(segments[1])) {
    segments.splice(1, 1)
  }
  const result = segments.join('/')
  return result === '' ? '/' : result
}

/**
 * The p75 of a sample set, by nearest-rank on the sorted values.
 *
 * Nearest-rank rather than interpolation because that is how CrUX and Vercel
 * report these, so the number here is comparable to the number in the Speed
 * Insights dashboard rather than systematically a little below it.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]
}

export interface WebVitalSampleRow {
  metric: string
  value: number
  authState?: string | null
  route?: string | null
}

export interface WebVitalSummary {
  metric: WebVitalMetric
  samples: number
  p75: number | null
  rating: WebVitalRating | null
  threshold: number
  unit: 'ms' | 'ratio'
  withinBudget: boolean | null
  byAuthState: Record<AuthState, { samples: number; p75: number | null }>
}

/**
 * Summarise raw samples into the row that goes in the budget document.
 *
 * `p75: null` with `samples: 0` is a first-class answer and must stay
 * distinguishable from a passing score: a pipeline that has collected nothing
 * yet has to read as "not measured", never as "0 ms, well within budget".
 * That confusion is what put this task on the board in the first place.
 */
export function summarizeWebVitals(rows: WebVitalSampleRow[]): WebVitalSummary[] {
  return WEB_VITAL_METRICS.map(metric => {
    const forMetric = rows.filter(row => row.metric === metric)
    const p75 = percentile(forMetric.map(row => row.value), 75)
    const { good, unit } = WEB_VITAL_THRESHOLDS[metric]

    const byAuthState = {} as WebVitalSummary['byAuthState']
    for (const state of AUTH_STATES) {
      const subset = forMetric.filter(row => row.authState === state)
      byAuthState[state] = {
        samples: subset.length,
        p75: percentile(subset.map(row => row.value), 75),
      }
    }

    return {
      metric,
      samples: forMetric.length,
      p75,
      rating: p75 === null ? null : rateWebVital(metric, p75),
      threshold: good,
      unit,
      withinBudget: p75 === null ? null : p75 <= good,
      byAuthState,
    }
  })
}

/** Render a value the way the budget document writes it. */
export function formatWebVital(metric: WebVitalMetric, value: number | null): string {
  if (value === null) return 'not yet recorded'
  return WEB_VITAL_THRESHOLDS[metric].unit === 'ms'
    ? `${Math.round(value)} ms`
    : value.toFixed(3)
}
