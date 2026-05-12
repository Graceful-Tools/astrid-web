import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RECENTLY_COMPLETED_WINDOW,
  getRecentlyCompletedCutoff,
  isTaskRecentlyCompleted,
} from '@/lib/recently-completed-window'

// Fixed "now" for deterministic tests: 2026-05-11 (Monday) 12:00 local.
const now = new Date('2026-05-11T12:00:00')

describe('getRecentlyCompletedCutoff', () => {
  it('default (null) means the legacy 24-hour window — exactly 24h before now', () => {
    const cutoff = getRecentlyCompletedCutoff(null, now)
    expect(cutoff.toISOString()).toBe(new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString())
  })

  it('DEFAULT_RECENTLY_COMPLETED_WINDOW resolves to the same 24h cutoff as null', () => {
    expect(getRecentlyCompletedCutoff(DEFAULT_RECENTLY_COMPLETED_WINDOW, now).getTime())
      .toBe(getRecentlyCompletedCutoff(null, now).getTime())
  })

  it('duration: last 7 days', () => {
    const cutoff = getRecentlyCompletedCutoff({ kind: 'duration', amount: 7, unit: 'day' }, now)
    expect(cutoff.getTime()).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  })

  it('duration: last 14 / 28 / 30 days', () => {
    for (const amount of [14, 28, 30]) {
      const cutoff = getRecentlyCompletedCutoff({ kind: 'duration', amount, unit: 'day' }, now)
      expect(cutoff.getTime()).toBe(now.getTime() - amount * 24 * 60 * 60 * 1000)
    }
  })

  it('duration: weeks', () => {
    const cutoff = getRecentlyCompletedCutoff({ kind: 'duration', amount: 2, unit: 'week' }, now)
    expect(cutoff.getTime()).toBe(now.getTime() - 14 * 24 * 60 * 60 * 1000)
  })

  it('since-weekday: "since last Sunday" anchors at 00:00 local on that day', () => {
    // now is Monday 2026-05-11. Last Sunday is 2026-05-10. Last-Sunday cutoff is 2026-05-10T00:00 local.
    const cutoff = getRecentlyCompletedCutoff({ kind: 'since-weekday', weekday: 0 }, now)
    expect(cutoff.getFullYear()).toBe(2026)
    expect(cutoff.getMonth()).toBe(4) // May (0-indexed)
    expect(cutoff.getDate()).toBe(10)
    expect(cutoff.getHours()).toBe(0)
    expect(cutoff.getMinutes()).toBe(0)
  })

  it('since-weekday: "since last Monday" — when now IS Monday, treat as start of today', () => {
    // Monday 2026-05-11 -> cutoff 2026-05-11T00:00.
    const cutoff = getRecentlyCompletedCutoff({ kind: 'since-weekday', weekday: 1 }, now)
    expect(cutoff.getDate()).toBe(11)
    expect(cutoff.getHours()).toBe(0)
  })

  it('since-weekday: "since last Tuesday" walks back to the previous week', () => {
    // Monday 2026-05-11 -> last Tuesday is 2026-05-05.
    const cutoff = getRecentlyCompletedCutoff({ kind: 'since-weekday', weekday: 2 }, now)
    expect(cutoff.getDate()).toBe(5)
    expect(cutoff.getMonth()).toBe(4)
  })

  it('since-day-of-month: "since the 1st" — current month', () => {
    const cutoff = getRecentlyCompletedCutoff({ kind: 'since-day-of-month', day: 1 }, now)
    expect(cutoff.getMonth()).toBe(4) // May
    expect(cutoff.getDate()).toBe(1)
    expect(cutoff.getHours()).toBe(0)
  })

  it('since-day-of-month: when the day has not occurred yet this month, roll back to prior month', () => {
    // now = May 11. "Since the 20th" rolls back to April 20.
    const cutoff = getRecentlyCompletedCutoff({ kind: 'since-day-of-month', day: 20 }, now)
    expect(cutoff.getMonth()).toBe(3) // April
    expect(cutoff.getDate()).toBe(20)
  })

  it('since-day-of-month: when the day is today, use today at 00:00', () => {
    // now = May 11. "Since the 11th" -> May 11 00:00.
    const cutoff = getRecentlyCompletedCutoff({ kind: 'since-day-of-month', day: 11 }, now)
    expect(cutoff.getMonth()).toBe(4)
    expect(cutoff.getDate()).toBe(11)
    expect(cutoff.getHours()).toBe(0)
  })

  it('since-date: parses YYYY-MM-DD at 00:00 local', () => {
    const cutoff = getRecentlyCompletedCutoff({ kind: 'since-date', date: '2026-04-01' }, now)
    expect(cutoff.getFullYear()).toBe(2026)
    expect(cutoff.getMonth()).toBe(3) // April
    expect(cutoff.getDate()).toBe(1)
    expect(cutoff.getHours()).toBe(0)
  })
})

describe('isTaskRecentlyCompleted', () => {
  const baseTask = {
    completed: true,
    updatedAt: new Date('2026-05-11T10:00:00'), // 2h before now
  }

  it('incomplete tasks are never "recently completed"', () => {
    expect(
      isTaskRecentlyCompleted({ ...baseTask, completed: false }, null, now),
    ).toBe(false)
  })

  it('completed task within the 24h default window → true', () => {
    expect(isTaskRecentlyCompleted(baseTask, null, now)).toBe(true)
  })

  it('completed task outside the 24h default window → false', () => {
    expect(
      isTaskRecentlyCompleted(
        { ...baseTask, updatedAt: new Date('2026-05-09T10:00:00') }, // 50h ago
        null,
        now,
      ),
    ).toBe(false)
  })

  it('respects a custom 7-day window', () => {
    const w = { kind: 'duration' as const, amount: 7, unit: 'day' as const }
    expect(
      isTaskRecentlyCompleted({ ...baseTask, updatedAt: new Date('2026-05-06T10:00:00') }, w, now),
    ).toBe(true)
    expect(
      isTaskRecentlyCompleted({ ...baseTask, updatedAt: new Date('2026-05-01T10:00:00') }, w, now),
    ).toBe(false)
  })

  it('returns false when the task has no updatedAt', () => {
    expect(
      isTaskRecentlyCompleted({ completed: true, updatedAt: null as unknown as Date }, null, now),
    ).toBe(false)
  })
})

import { shouldShowCompletedByFilter } from '@/lib/recently-completed-window'

describe('shouldShowCompletedByFilter (drives both list view default-mode and board Done column)', () => {
  const incomplete = { completed: false, updatedAt: new Date('2026-05-11T10:00:00') }
  const recentDone = { completed: true, updatedAt: new Date('2026-05-11T10:00:00') }  // 2h ago
  const oldDone =    { completed: true, updatedAt: new Date('2026-05-01T10:00:00') }  // 10 days ago

  it('"completed" mode shows only completed tasks regardless of window', () => {
    expect(shouldShowCompletedByFilter(incomplete, 'completed', null, now)).toBe(false)
    expect(shouldShowCompletedByFilter(recentDone, 'completed', null, now)).toBe(true)
    expect(shouldShowCompletedByFilter(oldDone, 'completed', null, now)).toBe(true)
  })

  it('"incomplete" mode shows only incomplete tasks regardless of window', () => {
    expect(shouldShowCompletedByFilter(incomplete, 'incomplete', null, now)).toBe(true)
    expect(shouldShowCompletedByFilter(recentDone, 'incomplete', null, now)).toBe(false)
  })

  it('"default" mode shows all incomplete + recently-completed (per the window)', () => {
    // Default window (null) = last 24h
    expect(shouldShowCompletedByFilter(incomplete, 'default', null, now)).toBe(true)
    expect(shouldShowCompletedByFilter(recentDone, 'default', null, now)).toBe(true)
    expect(shouldShowCompletedByFilter(oldDone, 'default', null, now)).toBe(false)
  })

  it('"default" mode with a custom 14-day window includes the 10-day-old completed task', () => {
    const window = { kind: 'duration' as const, amount: 14, unit: 'day' as const }
    expect(shouldShowCompletedByFilter(oldDone, 'default', window, now)).toBe(true)
  })

  it('"all" mode shows everything', () => {
    expect(shouldShowCompletedByFilter(incomplete, 'all', null, now)).toBe(true)
    expect(shouldShowCompletedByFilter(recentDone, 'all', null, now)).toBe(true)
    expect(shouldShowCompletedByFilter(oldDone, 'all', null, now)).toBe(true)
  })
})
