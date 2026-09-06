/**
 * Window arithmetic for rebuilding AnalyticsDailyStats over a date range.
 *
 * The rebuild itself is just `aggregateDailyStats(day)` per day: the raw
 * AnalyticsEvent rows were never lost, and AnalyticsDailyStats.date is @unique
 * with an upsert behind it, so re-running a day is idempotent (task 82752f76).
 *
 * The guard rails live here because the alternative already exists and is
 * dangerous: scripts/backfill-analytics.ts takes no window at all and rewrites
 * every day from the earliest event to the latest. A backfill that cannot say
 * which days it will touch is one nobody can review before it runs.
 */

/** Refuse windows past this, so a typo'd year cannot rewrite the whole table. */
export const MAX_WINDOW_DAYS = 400

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

function midnightUTC(label: string, value: string | undefined, flag: string): Date {
  if (!value) throw new Error(`Missing ${label}: pass ${flag} YYYY-MM-DD`)
  if (!ISO_DAY.test(value)) throw new Error(`${label} must be YYYY-MM-DD, got "${value}"`)

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be YYYY-MM-DD, got "${value}"`)
  }
  return parsed
}

export interface DayWindow {
  from: string | undefined
  to: string | undefined
}

/** Every UTC midnight from `from` to `to`, inclusive of both ends. */
export function parseDayWindow({ from, to }: DayWindow): Date[] {
  const start = midnightUTC('start date', from, '--from')
  const end = midnightUTC('end date', to, '--to')

  if (end.getTime() < start.getTime()) {
    throw new Error(`--from (${from}) must be on or before --to (${to})`)
  }

  const dayMs = 24 * 60 * 60 * 1000
  const count = Math.round((end.getTime() - start.getTime()) / dayMs) + 1
  if (count > MAX_WINDOW_DAYS) {
    throw new Error(
      `Window is ${count} days, above the ${MAX_WINDOW_DAYS}-day cap. ` +
        `Narrow it, or run it in chunks.`,
    )
  }

  return Array.from({ length: count }, (_, i) => new Date(start.getTime() + i * dayMs))
}
