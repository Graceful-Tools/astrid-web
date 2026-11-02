/**
 * Day differences across a daylight-saving change.
 *
 * getDaysDifference measured the gap between two LOCAL midnights in ms and
 * floored it by 24h. A local day is 25h when the clocks go back and 23h when
 * they go forward, so on 2026-11-02 (US fall-back was 11-01) a task due
 * yesterday read as two days ago, and on the evening before spring-forward a
 * task due tomorrow read "Today". CI caught it as the "Yesterday" test going
 * red on the morning after the change (AWTD-1511).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDaysDifference } from '@/lib/date-comparison'
import { formatDateForDisplay } from '@/lib/date-utils'

describe('getDaysDifference across a DST change', () => {
  let originalTZ: string | undefined
  beforeEach(() => {
    originalTZ = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
  })
  afterEach(() => {
    if (originalTZ === undefined) delete process.env.TZ
    else process.env.TZ = originalTZ
  })

  it('the day after fall-back: yesterday afternoon is -1, not -2', () => {
    const now = new Date(2026, 10, 2, 2, 41) // Nov 2, 02:41 PST
    const yesterday = new Date(2026, 10, 1, 14, 0) // Nov 1, 14:00 (the 25-hour day)
    expect(getDaysDifference(yesterday, now, false)).toBe(-1)
  })

  it('the evening before spring-forward: tomorrow is +1, not 0', () => {
    // Mar 14 2027 is the 23-hour day: its midnight to Mar 15's is 23h.
    const now = new Date(2027, 2, 14, 20, 0) // Mar 14, 20:00 PDT
    const tomorrow = new Date(2027, 2, 15, 9, 0) // Mar 15, 09:00
    expect(getDaysDifference(tomorrow, now, false)).toBe(1)
  })

  it('a week across fall-back is still 7 days', () => {
    const now = new Date(2026, 9, 28, 12, 0)
    const nextWeek = new Date(2026, 10, 4, 12, 0)
    expect(getDaysDifference(nextWeek, now, false)).toBe(7)
  })

  it('formatDateForDisplay says "Yesterday" on the morning after fall-back', () => {
    // new Date() reads the system clock, not Date.now (review on #636).
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 10, 2, 2, 41))
    try {
      expect(formatDateForDisplay(new Date(2026, 10, 1, 14, 0), false)).toBe('Yesterday')
    } finally {
      vi.useRealTimers()
    }
  })
})
