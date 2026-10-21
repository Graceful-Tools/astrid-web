import { describe, it, expect } from 'vitest'
import { calculateNextOccurrence, isValidRepeatingPattern } from '@/types/repeating'
import type { CustomRepeatingPattern, Weekday } from '@/types/repeating'

// AWTD-1295: `weekOfMonth: -1` means "the last <weekday> of the month" (iCalendar BYDAY -1MO).
const last = (weekday: Weekday, weekOfMonth = -1): CustomRepeatingPattern => ({
  type: 'custom',
  unit: 'months',
  interval: 1,
  endCondition: 'never',
  monthRepeatType: 'same_weekday',
  monthWeekday: { weekday, weekOfMonth },
})

const next = (pattern: CustomRepeatingPattern, due: string) =>
  calculateNextOccurrence(pattern, new Date(due), new Date(due), 'DUE_DATE', 0)

describe('AWTD-1295 last weekday of the month', () => {
  it('lands on the 4th Monday in a month with four Mondays', () => {
    expect(next(last('monday'), '2024-01-29T10:00:00Z').nextDueDate?.toISOString()).toBe('2024-02-26T00:00:00.000Z')
  })

  it('lands on the 5th Monday in a month with five Mondays', () => {
    expect(next(last('monday'), '2024-03-25T10:00:00Z').nextDueDate?.toISOString()).toBe('2024-04-29T00:00:00.000Z')
  })

  it('lands on the last day when the month ends on that weekday', () => {
    expect(next(last('sunday'), '2024-02-25T10:00:00Z').nextDueDate?.toISOString()).toBe('2024-03-31T00:00:00.000Z')
  })

  it('crosses a year boundary', () => {
    expect(next(last('friday'), '2024-12-27T10:00:00Z').nextDueDate?.toISOString()).toBe('2025-01-31T00:00:00.000Z')
  })

  it('does not skip a short month when the current date is the 31st', () => {
    // Jan 31 2024 is the last Wednesday. February must not be skipped by a "Feb 31" overflow.
    expect(next(last('wednesday'), '2024-01-31T10:00:00Z').nextDueDate?.toISOString()).toBe('2024-02-28T00:00:00.000Z')
  })

  it('reads any other negative as no weekday, which ends the series', () => {
    expect(next(last('monday', -2), '2024-01-29T10:00:00Z').nextDueDate).toBeNull()
  })

  it('is a valid pattern to save; -2, 0 and 6 are not', () => {
    expect(isValidRepeatingPattern(last('monday'))).toBe(true)
    expect(isValidRepeatingPattern(last('monday', 5))).toBe(true)
    expect(isValidRepeatingPattern(last('monday', -2))).toBe(false)
    expect(isValidRepeatingPattern(last('monday', 0))).toBe(false)
    expect(isValidRepeatingPattern(last('monday', 6))).toBe(false)
  })
})
