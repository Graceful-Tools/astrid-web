/**
 * AWTD-1184 — a task row shows ONE date format.
 *
 * `formatDateForDisplay` had two, and which one you saw depended on a flag the
 * viewer cannot see:
 *
 *   - all-day, beyond the relative window → `toLocaleDateString('en-US', {
 *     month: 'short', … })`, e.g. `Oct 8, 2026`
 *   - TIMED, beyond the relative window  → a bare `toLocaleDateString()`,
 *     which is locale-numeric: `11/9/2026`
 *
 * So two rows a day apart could read `Oct 8, 2026` and `11/9/2026`. The
 * existing test for this branch asserted only that the result was a string and
 * not "Today", with a comment that the format "depends on locale" — which is
 * the hole the numeric format lived in, so these assertions are exact.
 *
 * Jon's call (2026-10-10): keep web's relative words, fix the numeric slip.
 *
 * Every date here is built from LOCAL parts, so the expectations hold in
 * whatever zone the suite runs in. The one exception is the all-day case,
 * which is UTC on purpose — see the last test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { formatDateForDisplay } from '@/lib/date-utils'

describe('formatDateForDisplay row format (AWTD-1184)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Local midday: far from both the local and the UTC day boundary, so no
    // assertion here is one hour of drift away from passing by luck.
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spells the month on a timed date beyond the relative window', () => {
    expect(formatDateForDisplay(new Date(2026, 10, 9, 15, 0, 0), false)).toBe('Nov 9, 2026')
  })

  it('formats a timed date exactly as the all-day path formats the same day', () => {
    const timed = formatDateForDisplay(new Date(2026, 10, 9, 15, 0, 0), false)
    const allDay = formatDateForDisplay(new Date(Date.UTC(2026, 10, 9)), true)
    expect(timed).toBe(allDay)
  })

  it('keeps the relative words inside the window', () => {
    expect(formatDateForDisplay(new Date(2026, 9, 10, 17, 0, 0), false)).toBe('Today')
    expect(formatDateForDisplay(new Date(2026, 9, 11, 10, 0, 0), false)).toBe('Tomorrow')
    expect(formatDateForDisplay(new Date(2026, 9, 9, 9, 0, 0), false)).toBe('Yesterday')
  })

  it('still reads an all-day date in UTC, so it cannot shift a day', () => {
    // An all-day task carries midnight UTC. Formatting it locally would show
    // Oct 7 to every viewer behind UTC, which is the bug this branch avoids.
    expect(formatDateForDisplay(new Date(Date.UTC(2026, 9, 8)), true)).toBe('Oct 8, 2026')
  })
})
