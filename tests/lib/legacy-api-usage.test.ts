import { describe, expect, it } from 'vitest'
import { isLegacyApiPath } from '@/lib/api-deprecation'
import {
  LEGACY_USAGE_BEACON_PATH,
  legacyUsageBucket,
  summarizeLegacyUsage,
} from '@/lib/legacy-api-usage'

/**
 * Task 641a7615 — durable telemetry for `deprecation:legacy-api`.
 *
 * Acceptance says *"legacy traffic is queryable over a ≥4-week window, broken
 * down by route"* and *"every deleted route had demonstrably zero traffic for
 * a stated period"*. Today the signal is a `console.log` and Vercel retains a
 * window of minutes — the task's own words: *"deletion is a guess wearing a
 * data-driven costume."*
 *
 * This is the durable half: a daily bucket per (route × method × client) that
 * accumulates, so the ≥4-week window becomes a query instead of a hope.
 */
describe('legacy usage bucketing (task 641a7615)', () => {
  it('buckets a hit to UTC midnight of its day, so a "day" means the same thing everywhere', () => {
    const bucket = legacyUsageBucket({
      route: '/api/tasks',
      method: 'GET',
      platform: 'iOS-app',
      at: new Date('2026-08-02T23:59:59.999Z'),
    })

    expect(bucket.day.toISOString()).toBe('2026-08-02T00:00:00.000Z')
  })

  it('puts a hit one millisecond later into the next day', () => {
    const bucket = legacyUsageBucket({
      route: '/api/tasks',
      method: 'GET',
      platform: 'iOS-app',
      at: new Date('2026-08-03T00:00:00.000Z'),
    })

    expect(bucket.day.toISOString()).toBe('2026-08-03T00:00:00.000Z')
  })

  it('keeps route, method and client as the breakdown the acceptance asks for', () => {
    const bucket = legacyUsageBucket({
      route: '/api/lists/abc-123',
      method: 'PUT',
      platform: 'web-desktop',
      at: new Date('2026-08-02T10:00:00Z'),
    })

    expect(bucket.method).toBe('PUT')
    expect(bucket.platform).toBe('web-desktop')
  })

  it('collapses ids out of the route so /api/lists/<uuid> aggregates as one route', () => {
    // Otherwise every task id is its own row and "traffic on /api/lists" is
    // unanswerable — you would be counting 3,000 distinct routes.
    const uuid = legacyUsageBucket({
      route: '/api/lists/8f5e65cf-b5f2-4322-b0d5-e79e8f84c5f7',
      method: 'GET', platform: 'web-desktop', at: new Date('2026-08-02T00:00:00Z'),
    })
    const cuid = legacyUsageBucket({
      route: '/api/tasks/cmmry83x20000lrf9bf3ghhay',
      method: 'GET', platform: 'web-desktop', at: new Date('2026-08-02T00:00:00Z'),
    })

    expect(uuid.route).toBe('/api/lists/:id')
    expect(cuid.route).toBe('/api/tasks/:id')
  })

  it('leaves a route with no id alone', () => {
    const bucket = legacyUsageBucket({
      route: '/api/lists/public',
      method: 'GET', platform: 'web-desktop', at: new Date('2026-08-02T00:00:00Z'),
    })

    expect(bucket.route).toBe('/api/lists/public')
  })
})

describe('the beacon must not count itself (task 641a7615)', () => {
  it('excludes the beacon path from legacy telemetry', () => {
    // Recording a legacy hit is itself an /api/* request. If it counted, every
    // hit would generate a hit, forever.
    expect(isLegacyApiPath(LEGACY_USAGE_BEACON_PATH)).toBe(false)
  })

  it('excludes /api/internal/* generally — internal routes are not migration traffic', () => {
    // Pre-existing gap: /api/internal/user-model-preferences was being counted
    // as legacy traffic, inflating the census this whole plan reads from.
    expect(isLegacyApiPath('/api/internal/user-model-preferences')).toBe(false)
  })

  it('still counts the real legacy surface', () => {
    expect(isLegacyApiPath('/api/tasks')).toBe(true)
    expect(isLegacyApiPath('/api/lists/public')).toBe(true)
  })

  it('still excludes the v1 surface and existing internal prefixes', () => {
    expect(isLegacyApiPath('/api/v1/tasks')).toBe(false)
    expect(isLegacyApiPath('/api/cron/reminders')).toBe(false)
  })
})

describe('summarizeLegacyUsage — the question the task actually asks (641a7615)', () => {
  const rows = [
    { route: '/api/tasks', method: 'GET', platform: 'iOS-app', day: new Date('2026-07-05'), count: 5 },
    { route: '/api/tasks', method: 'GET', platform: 'web-desktop', day: new Date('2026-08-01'), count: 90 },
    { route: '/api/lists', method: 'GET', platform: 'web-desktop', day: new Date('2026-08-01'), count: 10 },
  ]

  it('totals traffic per route across the window', () => {
    const summary = summarizeLegacyUsage(rows, { now: new Date('2026-08-02T00:00:00Z') })

    expect(summary.find(r => r.route === '/api/tasks')?.total).toBe(95)
    expect(summary.find(r => r.route === '/api/lists')?.total).toBe(10)
  })

  it('reports the last day each route was hit, which is what "zero traffic since" means', () => {
    const summary = summarizeLegacyUsage(rows, { now: new Date('2026-08-02T00:00:00Z') })

    expect(summary.find(r => r.route === '/api/lists')?.lastSeen?.toISOString())
      .toBe(new Date('2026-08-01').toISOString())
  })

  it('breaks each route down by client', () => {
    const summary = summarizeLegacyUsage(rows, { now: new Date('2026-08-02T00:00:00Z') })
    const tasks = summary.find(r => r.route === '/api/tasks')!

    expect(tasks.byClient['iOS-app']).toBe(5)
    expect(tasks.byClient['web-desktop']).toBe(90)
  })

  it('refuses to call a route safe to delete on less than 4 weeks of evidence', () => {
    // The whole point. Two minutes of data must not read as "no traffic".
    const summary = summarizeLegacyUsage(
      [{ route: '/api/reminders/status', method: 'GET', platform: 'iOS-app', day: new Date('2026-08-01'), count: 1 }],
      { now: new Date('2026-08-02T00:00:00Z'), windowStart: new Date('2026-08-01T00:00:00Z') },
    )

    expect(summary[0].safeToDelete).toBe(false)
    expect(summary[0].reason).toMatch(/window/i)
  })

  it('marks a route safe only after a full window with zero traffic', () => {
    const summary = summarizeLegacyUsage(
      [{ route: '/api/tasks', method: 'GET', platform: 'iOS-app', day: new Date('2026-06-01'), count: 3 }],
      {
        now: new Date('2026-08-02T00:00:00Z'),
        windowStart: new Date('2026-07-01T00:00:00Z'),
        observingSince: new Date('2026-05-01T00:00:00Z'),
      },
    )

    // Last hit 2026-06-01 is before the window, and we have been observing
    // since well before it — so the window is genuinely empty.
    expect(summary[0].safeToDelete).toBe(true)
  })

  it('never marks the NextAuth mount safe, whatever the traffic says', () => {
    const summary = summarizeLegacyUsage(
      [{ route: '/api/auth/:id', method: 'GET', platform: 'web-desktop', day: new Date('2026-06-01'), count: 0 }],
      {
        now: new Date('2026-08-02T00:00:00Z'),
        windowStart: new Date('2026-07-01T00:00:00Z'),
        observingSince: new Date('2026-05-01T00:00:00Z'),
      },
    )

    expect(summary[0].safeToDelete).toBe(false)
    expect(summary[0].reason).toMatch(/never/i)
  })
})
