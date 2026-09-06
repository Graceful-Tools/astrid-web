/**
 * Task 82752f76-56bc-4ec9-8c7c-3de87f46edc4 — backfill the missing analytics days.
 *
 * The days are missing because aggregateDailyStats threw for months (task
 * 8f719931). The raw AnalyticsEvent rows survived, so rebuilding them needs
 * nothing but aggregateDailyStats(day) over the gap — an upsert against a
 * @unique date column, so it is safe to repeat.
 *
 * The script the task pointed at, scripts/backfill-analytics.ts, does something
 * else entirely: it FABRICATES AnalyticsEvent rows from Task/Comment/TaskList
 * records with platform 'unknown' and approximate timestamps, inserts them into
 * the real event table, and re-aggregates all of history. Its
 * `skipDuplicates: true` is a no-op because AnalyticsEvent has no unique
 * constraint, so each run adds another full copy of every synthetic event.
 */
import { describe, it, expect } from 'vitest'
import { parseDayWindow, MAX_WINDOW_DAYS } from '@/scripts/lib/analytics-reaggregation'

describe('parseDayWindow (task 82752f76)', () => {
  it('yields every day in the range, at midnight UTC, inclusive of both ends', () => {
    const days = parseDayWindow({ from: '2026-09-03', to: '2026-09-05' })
    expect(days.map((d) => d.toISOString())).toEqual([
      '2026-09-03T00:00:00.000Z',
      '2026-09-04T00:00:00.000Z',
      '2026-09-05T00:00:00.000Z',
    ])
  })

  it('treats a single-day window as one day, not zero', () => {
    const days = parseDayWindow({ from: '2026-09-05', to: '2026-09-05' })
    expect(days).toHaveLength(1)
    expect(days[0].toISOString()).toBe('2026-09-05T00:00:00.000Z')
  })

  it('requires both ends, so an unbounded run cannot rewrite all of history', () => {
    expect(() => parseDayWindow({ from: '2026-09-05', to: undefined })).toThrow(/--to/)
    expect(() => parseDayWindow({ from: undefined, to: '2026-09-05' })).toThrow(/--from/)
  })

  it('rejects a reversed range rather than silently doing nothing', () => {
    expect(() => parseDayWindow({ from: '2026-09-05', to: '2026-09-03' })).toThrow(/before/)
  })

  it('rejects an unparseable date rather than aggregating the epoch', () => {
    expect(() => parseDayWindow({ from: 'yesterday', to: '2026-09-05' })).toThrow(/YYYY-MM-DD/)
  })

  it('refuses a window larger than the cap', () => {
    expect(() => parseDayWindow({ from: '2020-01-01', to: '2026-09-05' })).toThrow(
      new RegExp(String(MAX_WINDOW_DAYS)),
    )
  })
})
