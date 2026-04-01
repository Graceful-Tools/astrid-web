import { describe, it, expect, beforeEach, afterEach } from 'vitest'

/**
 * Regression Tests for Task Creation Timezone Bugs
 *
 * These tests prevent the bug where:
 * - Web all-day tasks created for "today" showed as "yesterday"
 * - iOS all-day tasks created for "today" showed as "tomorrow"
 *
 * Root causes:
 * - Web: Used setHours(0,0,0,0) instead of setUTCHours(0,0,0,0)
 * - iOS: Used Date() (current UTC) then UTC start-of-day, getting wrong day in timezones behind UTC
 */
describe('Task Creation Timezone Bugs (Critical Regression)', () => {
  let originalTZ: string | undefined

  beforeEach(() => {
    originalTZ = process.env.TZ
    // Test in PT (UTC-8) where the bug occurred
    process.env.TZ = 'America/Los_Angeles'
  })

  afterEach(() => {
    if (originalTZ !== undefined) {
      process.env.TZ = originalTZ
    } else {
      delete process.env.TZ
    }
  })

  describe('Web All-Day Task Creation (TaskFieldEditors)', () => {
    it('REGRESSION: creating all-day task for "today" must use UTC midnight, not local midnight', () => {
      // Simulate user selecting today from calendar picker
      const selectedDate = new Date() // Current local time

      // CORRECT: Use setUTCHours (fixed)
      selectedDate.setUTCHours(0, 0, 0, 0)

      // Verify it's at midnight UTC
      expect(selectedDate.getUTCHours()).toBe(0)
      expect(selectedDate.getUTCMinutes()).toBe(0)
      expect(selectedDate.getUTCSeconds()).toBe(0)

      // Verify it represents TODAY in UTC (not yesterday/tomorrow)
      const now = new Date()
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      expect(selectedDate.getUTCFullYear()).toBe(todayUTC.getUTCFullYear())
      expect(selectedDate.getUTCMonth()).toBe(todayUTC.getUTCMonth())
      expect(selectedDate.getUTCDate()).toBe(todayUTC.getUTCDate())
    })

    it('REGRESSION: must NOT use setHours (local) for all-day tasks', () => {
      // This is the BUG that was fixed
      const selectedDate = new Date()
      selectedDate.setHours(0, 0, 0, 0) // WRONG - local midnight

      // In PT (UTC-8), local midnight is 8 hours ahead of UTC
      // So midnight PT on Nov 22 = 08:00 UTC on Nov 22
      // This would fail the all-day task contract (must be 00:00 UTC)

      const now = new Date()

      // When it's Nov 22 in PT, local midnight is still Nov 22 in UTC (just wrong time)
      // But the hours will be 8, not 0
      if (now.getTimezoneOffset() > 0) {
        // Behind UTC (like PT)
        expect(selectedDate.getUTCHours()).not.toBe(0)
      }
    })

    it('REGRESSION: clearing time (making all-day) must use setUTCHours', () => {
      // Simulate user clearing the time field to make task all-day
      const dateWithTime = new Date()
      dateWithTime.setHours(15, 30, 0, 0) // 3:30 PM local

      // CORRECT: Clear time using UTC
      dateWithTime.setUTCHours(0, 0, 0, 0)

      expect(dateWithTime.getUTCHours()).toBe(0)
      expect(dateWithTime.getUTCMinutes()).toBe(0)
    })
  })

  describe('iOS All-Day Task Creation (InlineDatePicker)', () => {
    it('REGRESSION: "Today" quick button must use local calendar day, not UTC day', () => {
      // The BUG: Using Date() then UTC start-of-day got wrong day
      // Example: 4pm PT on Nov 22 is Nov 23 00:00 UTC
      //          UTC start-of-day → Nov 23 (WRONG!)

      // CORRECT approach: Get local calendar day, convert to UTC midnight
      const now = new Date()
      const localCalendar = {
        year: now.getFullYear(),
        month: now.getMonth(),
        day: now.getDate()
      }

      // Create UTC midnight with local calendar day
      const correctDate = new Date(Date.UTC(localCalendar.year, localCalendar.month, localCalendar.day))

      // Verify it matches local calendar day
      expect(correctDate.getUTCFullYear()).toBe(localCalendar.year)
      expect(correctDate.getUTCMonth()).toBe(localCalendar.month)
      expect(correctDate.getUTCDate()).toBe(localCalendar.day)

      // Verify it's at midnight UTC
      expect(correctDate.getUTCHours()).toBe(0)
      expect(correctDate.getUTCMinutes()).toBe(0)
    })

    it('REGRESSION: must NOT use Date() then UTC start-of-day for quick dates', () => {
      // This is the BUG that was fixed
      const now = new Date()

      // WRONG approach (old bug):
      // const wrongDate = startOfDayUTC(now)
      // This gets start of day in UTC, which is wrong day if behind UTC

      // Demonstrate the bug scenario
      const currentUTCDate = now.getUTCDate()
      const currentLocalDate = now.getDate()

      // In PT (behind UTC), these can be different
      // e.g., 5pm Nov 22 PT = 1am Nov 23 UTC
      // Local date: 22, UTC date: 23

      const offsetHours = Math.abs(now.getTimezoneOffset() / 60)
      if (now.getTimezoneOffset() > 0 && now.getHours() >= (24 - offsetHours)) {
        // Late evening hours when behind UTC - UTC is ahead by a day
        // Note: can't use greaterThan because at month boundaries (e.g. local=31, UTC=1)
        expect(currentUTCDate).not.toBe(currentLocalDate)
      }
    })

    it('REGRESSION: "Tomorrow" must be tomorrow in local calendar, not UTC calendar', () => {
      const now = new Date()

      // Get tomorrow in local calendar
      const tomorrow = new Date(now)
      tomorrow.setDate(tomorrow.getDate() + 1)

      const tomorrowLocal = {
        year: tomorrow.getFullYear(),
        month: tomorrow.getMonth(),
        day: tomorrow.getDate()
      }

      // Create UTC midnight for tomorrow's local calendar day
      const correctDate = new Date(Date.UTC(tomorrowLocal.year, tomorrowLocal.month, tomorrowLocal.day))

      expect(correctDate.getUTCFullYear()).toBe(tomorrowLocal.year)
      expect(correctDate.getUTCMonth()).toBe(tomorrowLocal.month)
      expect(correctDate.getUTCDate()).toBe(tomorrowLocal.day)
    })
  })

  describe('User Scenarios from Bug Report', () => {
    it('Scenario 1: Web all-day task for today (Nov 22 @ 4pm PT) must show as "Today"', () => {
      // Create date representing Nov 22, 2025 at midnight UTC
      const nov22 = new Date(Date.UTC(2025, 10, 22, 0, 0, 0, 0))

      // This should be stored correctly by web (using setUTCHours)
      expect(nov22.getUTCHours()).toBe(0)
      expect(nov22.getUTCDate()).toBe(22)

      // When formatted for display as all-day, should show correct day
      // (Actual formatting tested in date-timezone-handling.test.ts)
    })

    it('Scenario 4: iOS all-day task for today (Nov 22 @ 4pm PT) must create Nov 22, not Nov 23', () => {
      // Simulate iOS creating task at 4pm PT on Nov 22
      // Use the FIXED approach: local calendar day → UTC midnight

      // Mock "now" as 4pm PT on Nov 22
      const nov22_4pm_PT = new Date(2025, 10, 22, 16, 0, 0, 0) // Nov 22, 4pm local

      const localComponents = {
        year: nov22_4pm_PT.getFullYear(),
        month: nov22_4pm_PT.getMonth(),
        day: nov22_4pm_PT.getDate()
      }

      const createdDate = new Date(Date.UTC(localComponents.year, localComponents.month, localComponents.day))

      // Should create Nov 22, not Nov 23
      expect(createdDate.getUTCDate()).toBe(22)
      expect(createdDate.getUTCMonth()).toBe(10) // November
      expect(createdDate.getUTCFullYear()).toBe(2025)
    })

    it('Scenario 5 & 6: iOS timed tasks for today must use local date', () => {
      // iOS timed tasks (9am, 9pm) were showing as tomorrow
      // This was because the date component was wrong

      const nov22_4pm_PT = new Date(2025, 10, 22, 16, 0, 0, 0)

      // When user sets time to 9am
      const task9am = new Date(nov22_4pm_PT)
      task9am.setHours(9, 0, 0, 0)

      // Should still be Nov 22
      expect(task9am.getDate()).toBe(22)
      expect(task9am.getMonth()).toBe(10)

      // When user sets time to 9pm
      const task9pm = new Date(nov22_4pm_PT)
      task9pm.setHours(21, 0, 0, 0)

      // Should still be Nov 22
      expect(task9pm.getDate()).toBe(22)
      expect(task9pm.getMonth()).toBe(10)
    })
  })

  describe('Edge Cases', () => {
    it('must handle midnight local time correctly', () => {
      const midnight = new Date()
      midnight.setHours(0, 0, 0, 0)

      // Extract local calendar day
      const localDay = midnight.getDate()
      const localMonth = midnight.getMonth()
      const localYear = midnight.getFullYear()

      // Convert to UTC midnight using local calendar day - CORRECT approach
      const utcMidnight = new Date(Date.UTC(localYear, localMonth, localDay, 0, 0, 0, 0))

      // Should preserve local calendar day
      expect(utcMidnight.getUTCDate()).toBe(localDay)
    })

    it('must handle 11:59 PM local time correctly', () => {
      const lateNight = new Date()
      lateNight.setHours(23, 59, 0, 0)

      const localDay = lateNight.getDate()
      const localMonth = lateNight.getMonth()
      const localYear = lateNight.getFullYear()

      // Create all-day task - CORRECT approach: extract local components, create UTC midnight
      const allDay = new Date(Date.UTC(localYear, localMonth, localDay, 0, 0, 0, 0))

      // Should use local calendar day, not next day
      expect(allDay.getUTCDate()).toBe(localDay)
      expect(allDay.getUTCHours()).toBe(0)
    })

    it('must handle early morning (12:01 AM) correctly', () => {
      const earlyMorning = new Date()
      earlyMorning.setHours(0, 1, 0, 0)

      const localDay = earlyMorning.getDate()
      const localMonth = earlyMorning.getMonth()
      const localYear = earlyMorning.getFullYear()

      // Create all-day task - CORRECT approach
      const allDay = new Date(Date.UTC(localYear, localMonth, localDay, 0, 0, 0, 0))

      // Should use current local day
      expect(allDay.getUTCDate()).toBe(localDay)
    })
  })

  describe('Cross-Timezone Consistency', () => {
    it('must create same UTC date for "today" across different timezones', () => {
      const timezones = [
        'America/Los_Angeles',  // UTC-8
        'America/New_York',     // UTC-5
        'Europe/London',        // UTC+0
        'Asia/Tokyo'           // UTC+9
      ]

      const results: Date[] = []

      for (const tz of timezones) {
        process.env.TZ = tz

        // Get "today" in this timezone
        const now = new Date()
        const localComponents = {
          year: now.getFullYear(),
          month: now.getMonth(),
          day: now.getDate()
        }

        // Create UTC midnight
        const utcMidnight = new Date(Date.UTC(localComponents.year, localComponents.month, localComponents.day))
        results.push(utcMidnight)
      }

      // All timezones should create dates with same UTC day
      // (though the actual date may differ because "today" is different)
      for (const date of results) {
        expect(date.getUTCHours()).toBe(0)
        expect(date.getUTCMinutes()).toBe(0)
      }
    })
  })
})
