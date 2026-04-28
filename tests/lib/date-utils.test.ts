import { describe, it, expect, beforeEach } from 'vitest'
import { parseRelativeDate, formatDateForDisplay } from '@/lib/date-utils'

// Helper to create a date at midnight in local timezone
// Uses year/month/day to avoid timezone parsing issues with date strings
function createLocalMidnight(year: number, month: number, day: number): Date {
  const date = new Date(year, month - 1, day) // month is 0-indexed
  date.setHours(0, 0, 0, 0)
  return date
}

describe('parseRelativeDate', () => {
  let mockDate: Date

  beforeEach(() => {
    // Mock the current date to December 31, 2023 which is a SUNDAY
    // This ensures consistent behavior across timezones
    mockDate = createLocalMidnight(2023, 12, 31)
    vi.useFakeTimers()
    vi.setSystemTime(mockDate)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('basic relative dates', () => {
    it('should return null for "none"', () => {
      expect(parseRelativeDate('none')).toBeNull()
    })

    it('should return null for null/undefined', () => {
      expect(parseRelativeDate(null)).toBeNull()
      expect(parseRelativeDate(undefined)).toBeNull()
    })

    it('should return today for "today"', () => {
      const result = parseRelativeDate('today')
      expect(result).toEqual(mockDate)
    })

    it('should return tomorrow for "tomorrow"', () => {
      const result = parseRelativeDate('tomorrow')
      const expected = createLocalMidnight(2024, 1, 1) // Jan 1, 2024
      expect(result).toEqual(expected)
    })

    it('should return next week for "next week"', () => {
      const result = parseRelativeDate('next week')
      const expected = createLocalMidnight(2024, 1, 7) // Jan 7, 2024 (7 days from Dec 31)
      expect(result).toEqual(expected)
    })

    it('should return this week (Friday) for "this week"', () => {
      const result = parseRelativeDate('this week')
      const expected = createLocalMidnight(2024, 1, 5) // Jan 5, 2024 (Friday, 5 days from Sunday)
      expect(result).toEqual(expected)
    })
  })

  describe('weekday parsing', () => {
    // Mock date is Sunday Dec 31, 2023
    it('should return next Monday for "monday"', () => {
      const result = parseRelativeDate('monday')
      const expected = createLocalMidnight(2024, 1, 1) // Jan 1, 2024 (1 day from Sunday)
      expect(result).toEqual(expected)
    })

    it('should return next Tuesday for "tuesday"', () => {
      const result = parseRelativeDate('tuesday')
      const expected = createLocalMidnight(2024, 1, 2) // Jan 2, 2024 (2 days from Sunday)
      expect(result).toEqual(expected)
    })

    it('should return next Wednesday for "wednesday"', () => {
      const result = parseRelativeDate('wednesday')
      const expected = createLocalMidnight(2024, 1, 3) // Jan 3, 2024 (3 days from Sunday)
      expect(result).toEqual(expected)
    })

    it('should return next Thursday for "thursday"', () => {
      const result = parseRelativeDate('thursday')
      const expected = createLocalMidnight(2024, 1, 4) // Jan 4, 2024 (4 days from Sunday)
      expect(result).toEqual(expected)
    })

    it('should return next Friday for "friday"', () => {
      const result = parseRelativeDate('friday')
      const expected = createLocalMidnight(2024, 1, 5) // Jan 5, 2024 (5 days from Sunday)
      expect(result).toEqual(expected)
    })

    it('should return next Saturday for "saturday"', () => {
      const result = parseRelativeDate('saturday')
      const expected = createLocalMidnight(2024, 1, 6) // Jan 6, 2024 (6 days from Sunday)
      expect(result).toEqual(expected)
    })

    it('should return next Sunday for "sunday"', () => {
      const result = parseRelativeDate('sunday')
      const expected = createLocalMidnight(2024, 1, 7) // Jan 7, 2024 (7 days from Sunday - since today is Sunday)
      expect(result).toEqual(expected)
    })

    it('should handle abbreviated weekday names', () => {
      expect(parseRelativeDate('mon')).toEqual(parseRelativeDate('monday'))
      expect(parseRelativeDate('tue')).toEqual(parseRelativeDate('tuesday'))
      expect(parseRelativeDate('wed')).toEqual(parseRelativeDate('wednesday'))
      expect(parseRelativeDate('thu')).toEqual(parseRelativeDate('thursday'))
      expect(parseRelativeDate('fri')).toEqual(parseRelativeDate('friday'))
      expect(parseRelativeDate('sat')).toEqual(parseRelativeDate('saturday'))
      expect(parseRelativeDate('sun')).toEqual(parseRelativeDate('sunday'))
    })
  })

  describe('case insensitive', () => {
    it('should handle uppercase', () => {
      expect(parseRelativeDate('TOMORROW')).toEqual(parseRelativeDate('tomorrow'))
      expect(parseRelativeDate('MONDAY')).toEqual(parseRelativeDate('monday'))
    })

    it('should handle mixed case', () => {
      expect(parseRelativeDate('ToMoRrOw')).toEqual(parseRelativeDate('tomorrow'))
      expect(parseRelativeDate('MoNdAy')).toEqual(parseRelativeDate('monday'))
    })
  })

  describe('whitespace handling', () => {
    it('should trim whitespace', () => {
      expect(parseRelativeDate('  tomorrow  ')).toEqual(parseRelativeDate('tomorrow'))
      expect(parseRelativeDate('\t\nmonday\t\n')).toEqual(parseRelativeDate('monday'))
    })
  })

  describe('regular date parsing', () => {
    it('should parse ISO date strings', () => {
      const isoDate = '2024-01-15T00:00:00.000Z'
      const result = parseRelativeDate(isoDate)
      expect(result).toEqual(new Date(isoDate))
    })

    it('should parse date strings', () => {
      const dateString = '2024-01-15'
      const result = parseRelativeDate(dateString)
      expect(result).toEqual(new Date(dateString))
    })

    it('should return null for invalid dates', () => {
      expect(parseRelativeDate('invalid-date')).toBeNull()
      expect(parseRelativeDate('not-a-date')).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(parseRelativeDate('')).toBeNull()
    })

    it('should handle whitespace only', () => {
      expect(parseRelativeDate('   ')).toBeNull()
    })

    it('should handle unknown relative dates', () => {
      const result = parseRelativeDate('unknown-date')

      expect(result).toBeNull()
    })
  })
})

describe('formatDateForDisplay', () => {
  let mockDate: Date

  beforeEach(() => {
    mockDate = new Date('2024-01-01T00:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(mockDate)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return "No due date" for null', () => {
    expect(formatDateForDisplay(null)).toBe('No due date')
  })

  it('should return "Today" for today', () => {
    expect(formatDateForDisplay(mockDate)).toBe('Today')
  })

  it('should return "Tomorrow" for tomorrow', () => {
    const tomorrow = new Date('2024-01-02T00:00:00.000Z')
    expect(formatDateForDisplay(tomorrow)).toBe('Tomorrow')
  })

  it('should return formatted date for other dates', () => {
    const futureDate = new Date('2024-01-15T00:00:00.000Z')
    const result = formatDateForDisplay(futureDate)
    
    // The exact format depends on locale, so we'll just check it's not "Today" or "Tomorrow"
    expect(result).not.toBe('Today')
    expect(result).not.toBe('Tomorrow')
    expect(typeof result).toBe('string')
  })
})

describe('integration scenarios', () => {
  let mockDate: Date

  beforeEach(() => {
    // Mock date is Sunday Dec 31, 2023 (same as other tests for consistency)
    mockDate = createLocalMidnight(2023, 12, 31)
    vi.useFakeTimers()
    vi.setSystemTime(mockDate)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should handle task creation with list defaults', () => {
    // Simulate a list with default due date set to "tomorrow"
    const listDefaultDueDate = 'tomorrow'
    const parsedDate = parseRelativeDate(listDefaultDueDate)

    expect(parsedDate).toEqual(createLocalMidnight(2024, 1, 1)) // Jan 1, 2024
  })

  it('should handle task creation with list defaults set to "friday"', () => {
    // Simulate a list with default due date set to "friday"
    const listDefaultDueDate = 'friday'
    const parsedDate = parseRelativeDate(listDefaultDueDate)

    expect(parsedDate).toEqual(createLocalMidnight(2024, 1, 5)) // Jan 5, 2024 (Friday, 5 days from Sunday)
  })

  it('should handle task creation with list defaults set to "next week"', () => {
    // Simulate a list with default due date set to "next week"
    const listDefaultDueDate = 'next week'
    const parsedDate = parseRelativeDate(listDefaultDueDate)

    expect(parsedDate).toEqual(createLocalMidnight(2024, 1, 7)) // Jan 7, 2024 (7 days from Dec 31)
  })

  it('should handle task creation with list defaults set to "none"', () => {
    // Simulate a list with default due date set to "none"
    const listDefaultDueDate = 'none'
    const parsedDate = parseRelativeDate(listDefaultDueDate)

    expect(parsedDate).toBeNull()
  })
})
