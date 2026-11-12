import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildTask } from '../fixtures/domain'
import {
  isTaskDueToday,
  isTaskOverdue,
  isTaskDueThisWeek,
  isTaskDueThisMonth,
  applyDateFilter,
  coreDueDateWindow,
} from '@/lib/date-filter-utils'
import type { Task } from '@/types/task'

/**
 * Date Filter Utilities Test Suite
 *
 * Tests the Google Calendar-style date filtering approach:
 * - All-day tasks: UTC comparison (timezone-independent)
 * - Timed tasks: Local timezone comparison
 *
 * Critical scenarios tested:
 * 1. All-day task due "today" shows in "Today" filter
 * 2. All-day task due "tomorrow" is not shown as "Today"
 * 3. Timed tasks respect local timezone
 * 4. Timezone changes don't affect all-day tasks
 * 5. All filters work correctly
 */

// Helper to create a mock task
function createMockTask(dueDateTime: string | null, isAllDay: boolean): Task {
  return buildTask({
    id: 'test-task-id',
    title: 'Test Task',
    description: '',
    priority: 0,
    repeating: 'never',
    isPrivate: true,
    completed: false,
    // `dueDateTime` is a Date on Task; the helper takes an ISO string because
    // that is what these cases are written as, so convert here rather than
    // pretending the field is a string. (AWTD-916)
    dueDateTime: dueDateTime === null ? null : new Date(dueDateTime),
    isAllDay: isAllDay,
    lists: [],
  })
}

describe('Date Filter Utils - Google Calendar Specification', () => {
  beforeEach(() => {
    // Mock current date to Jan 15, 2025 at 10 AM local time
    const mockDate = new Date('2025-01-15T10:00:00.000')
    vi.useFakeTimers()
    vi.setSystemTime(mockDate)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('isTaskDueToday - All-Day Tasks', () => {
    it('should return true for all-day task due today (stored at UTC midnight)', () => {
      // CRITICAL: All-day task stored at midnight UTC for today's date
      const now = new Date()
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      const task = createMockTask(todayUTC.toISOString(), true)

      expect(isTaskDueToday(task)).toBe(true)
    })

    it('should return false for all-day task due tomorrow', () => {
      const now = new Date()
      const tomorrowUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))

      const task = createMockTask(tomorrowUTC.toISOString(), true)

      expect(isTaskDueToday(task)).toBe(false)
    })

    it('should return false for all-day task due yesterday', () => {
      const now = new Date()
      const yesterdayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))

      const task = createMockTask(yesterdayUTC.toISOString(), true)

      expect(isTaskDueToday(task)).toBe(false)
    })

    it('should use UTC comparison for all-day tasks (timezone-independent)', () => {
      // Create task for Jan 15, 2025 at midnight UTC
      const taskDate = new Date(Date.UTC(2025, 0, 15, 0, 0, 0))
      const task = createMockTask(taskDate.toISOString(), true)

      // Should be true regardless of local timezone offset
      expect(isTaskDueToday(task)).toBe(true)
    })
  })

  describe('isTaskDueToday - Timed Tasks', () => {
    it('should return true for timed task due today at any time', () => {
      // Timed task due today at 2 PM local time
      const now = new Date()
      const todayAt2PM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0)

      const task = createMockTask(todayAt2PM.toISOString(), false)

      expect(isTaskDueToday(task)).toBe(true)
    })

    it('should return false for timed task due tomorrow', () => {
      const now = new Date()
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 14, 0, 0)

      const task = createMockTask(tomorrow.toISOString(), false)

      expect(isTaskDueToday(task)).toBe(false)
    })

    it('should use local timezone comparison for timed tasks', () => {
      // Timed task due Jan 15, 2025 at 9 PM local
      const timedDate = new Date(2025, 0, 15, 21, 0, 0)
      const task = createMockTask(timedDate.toISOString(), false)

      expect(isTaskDueToday(task)).toBe(true)
    })
  })

  describe('isTaskOverdue - All-Day Tasks', () => {
    it('should return true for all-day task due yesterday', () => {
      const now = new Date()
      const yesterdayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))

      const task = createMockTask(yesterdayUTC.toISOString(), true)

      expect(isTaskOverdue(task)).toBe(true)
    })

    it('should return false for all-day task due today', () => {
      const now = new Date()
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      const task = createMockTask(todayUTC.toISOString(), true)

      expect(isTaskOverdue(task)).toBe(false)
    })

    it('should return false for all-day task due tomorrow', () => {
      const now = new Date()
      const tomorrowUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))

      const task = createMockTask(tomorrowUTC.toISOString(), true)

      expect(isTaskOverdue(task)).toBe(false)
    })
  })

  describe('isTaskOverdue - Timed Tasks', () => {
    it('AWTD-1583 (D34): a timed task due 1 hour ago is due today, not overdue, until its day has passed', () => {
      const oneHourAgo = new Date()
      oneHourAgo.setHours(oneHourAgo.getHours() - 1)

      const task = createMockTask(oneHourAgo.toISOString(), false)

      expect(isTaskOverdue(task)).toBe(false)
      expect(isTaskDueToday(task)).toBe(true)
    })

    it('should return false for timed task due 1 hour from now', () => {
      const oneHourLater = new Date()
      oneHourLater.setHours(oneHourLater.getHours() + 1)

      const task = createMockTask(oneHourLater.toISOString(), false)

      expect(isTaskOverdue(task)).toBe(false)
    })

    it('should return true for timed task due yesterday', () => {
      const yesterday = new Date()
      yesterday.setDate(yesterday.getDate() - 1)

      const task = createMockTask(yesterday.toISOString(), false)

      expect(isTaskOverdue(task)).toBe(true)
    })
  })

  describe('isTaskDueThisWeek', () => {
    it('should return true for all-day task due in 3 days', () => {
      const now = new Date()
      const threeDaysUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3))

      const task = createMockTask(threeDaysUTC.toISOString(), true)

      expect(isTaskDueThisWeek(task)).toBe(true)
    })

    it('should return true for all-day task due in 7 days', () => {
      const now = new Date()
      const sevenDaysUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7))

      const task = createMockTask(sevenDaysUTC.toISOString(), true)

      expect(isTaskDueThisWeek(task)).toBe(true)
    })

    it('should return false for all-day task due in 8 days', () => {
      const now = new Date()
      const eightDaysUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 8))

      const task = createMockTask(eightDaysUTC.toISOString(), true)

      expect(isTaskDueThisWeek(task)).toBe(false)
    })

    it('should include today in "this week"', () => {
      const now = new Date()
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      const task = createMockTask(todayUTC.toISOString(), true)

      expect(isTaskDueThisWeek(task)).toBe(true)
    })
  })

  describe('isTaskDueThisMonth', () => {
    it('should return true for all-day task due in 15 days', () => {
      const now = new Date()
      const fifteenDaysUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 15))

      const task = createMockTask(fifteenDaysUTC.toISOString(), true)

      expect(isTaskDueThisMonth(task)).toBe(true)
    })

    it('should return true for all-day task due in 30 days', () => {
      const now = new Date()
      const thirtyDaysUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 30))

      const task = createMockTask(thirtyDaysUTC.toISOString(), true)

      expect(isTaskDueThisMonth(task)).toBe(true)
    })

    it('should return false for all-day task due in 31 days', () => {
      const now = new Date()
      const thirtyOneDaysUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 31))

      const task = createMockTask(thirtyOneDaysUTC.toISOString(), true)

      expect(isTaskDueThisMonth(task)).toBe(false)
    })
  })

  describe('applyDateFilter - Generic Filter Function', () => {
    it('should apply "today" filter correctly', () => {
      const now = new Date()
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      const task = createMockTask(todayUTC.toISOString(), true)

      expect(applyDateFilter(task, 'today')).toBe(true)
    })

    it('AWTD-1583 (D35, D7): a retired window reads as an unknown value — dated tasks kept, undated dropped', () => {
      const now = new Date()
      const nextMonthUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1))

      for (const retired of ['tomorrow', 'this_calendar_week', 'this_calendar_month', 'someday']) {
        expect(applyDateFilter(createMockTask(nextMonthUTC.toISOString(), true), retired), retired).toBe(true)
        expect(applyDateFilter(createMockTask(null, false), retired), retired).toBe(false)
      }
    })

    it('AWTD-1583: a SAVED retired window is read as the nearest window every client has', () => {
      expect(coreDueDateWindow('tomorrow')).toBe('this_week')
      expect(coreDueDateWindow('this_calendar_week')).toBe('this_week')
      expect(coreDueDateWindow('this_calendar_month')).toBe('this_month')
      for (const kept of ['all', 'overdue', 'today', 'this_week', 'this_month', 'no_date', 'someday']) {
        expect(coreDueDateWindow(kept)).toBe(kept)
      }
      expect(coreDueDateWindow(null)).toBe(null)
    })

    it('AWTD-1583: overdue is for open tasks only', () => {
      const now = new Date()
      const yesterdayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
      expect(applyDateFilter({ ...createMockTask(yesterdayUTC.toISOString(), true), completed: true }, 'overdue')).toBe(false)
    })

    it('should apply "this_week" filter correctly', () => {
      const now = new Date()
      const threeDaysUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 3))

      const task = createMockTask(threeDaysUTC.toISOString(), true)

      expect(applyDateFilter(task, 'this_week')).toBe(true)
    })

    it('should apply "overdue" filter correctly', () => {
      const now = new Date()
      const yesterdayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))

      const task = createMockTask(yesterdayUTC.toISOString(), true)

      expect(applyDateFilter(task, 'overdue')).toBe(true)
    })

    it('should apply "no_date" filter correctly', () => {
      const task = createMockTask(null, false)

      expect(applyDateFilter(task, 'no_date')).toBe(true)
    })

    it('should return true for "all" filter', () => {
      const task = createMockTask(null, false)

      expect(applyDateFilter(task, 'all')).toBe(true)
    })
  })

  describe('Edge Cases', () => {
    it('should handle null dueDateTime', () => {
      const task = createMockTask(null, false)

      expect(isTaskDueToday(task)).toBe(false)
      expect(isTaskOverdue(task)).toBe(false)
    })

    it('should handle invalid date strings gracefully', () => {
      const task = createMockTask('invalid-date', true)

      // Invalid dates should result in Invalid Date, which fails comparisons
      expect(isTaskDueToday(task)).toBe(false)
    })
  })

  describe('REGRESSION TESTS - Critical iOS/Web Sync Scenarios', () => {
    it('REGRESSION: All-day task created for "Today" on iOS must show "Today" on web', () => {
      // User in any timezone creates all-day task due "today"
      // iOS stores: midnight UTC for current day
      const now = new Date()
      const todayMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      const task = createMockTask(todayMidnightUTC.toISOString(), true)

      // Web MUST display "Today" (not "Yesterday")
      expect(isTaskDueToday(task)).toBe(true)
      expect(applyDateFilter(task, 'today')).toBe(true)
    })

    it('REGRESSION: All-day task created for "Tomorrow" on iOS must show "Tomorrow" on web', () => {
      const now = new Date()
      const tomorrowMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))

      const task = createMockTask(tomorrowMidnightUTC.toISOString(), true)

      // Web MUST NOT display it as "Today"; a saved "Tomorrow" filter (retired in AWTD-1583)
      // reads as the next 7 days, which holds it.
      expect(isTaskDueToday(task)).toBe(false)
      expect(applyDateFilter(task, coreDueDateWindow('tomorrow'))).toBe(true)
      expect(applyDateFilter(task, 'today')).toBe(false)
    })

    it('REGRESSION: Timed task created on iOS must show correct day on web', () => {
      // User creates timed task due today at 9 PM
      const today = new Date()
      today.setHours(21, 0, 0, 0)

      const task = createMockTask(today.toISOString(), false)

      // Web MUST display "Today" (respecting local timezone)
      expect(isTaskDueToday(task)).toBe(true)
    })

    it('REGRESSION: All-day tasks must be timezone-independent', () => {
      // All-day task stored at midnight UTC for Jan 15, 2025
      const specificDayUTC = new Date(Date.UTC(2025, 0, 15, 0, 0, 0, 0))

      const task = createMockTask(specificDayUTC.toISOString(), true)

      // Should work correctly regardless of local timezone
      // (test runs at mocked time of Jan 15, 2025 10 AM local)
      expect(isTaskDueToday(task)).toBe(true)
    })
  })
})
