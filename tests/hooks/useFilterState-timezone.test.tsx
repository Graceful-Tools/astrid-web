import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { buildTask, buildTaskList } from '../fixtures/domain'
import { renderHook, act } from '@testing-library/react'
import { useFilterState } from '@/hooks/useFilterState'
import type { Task } from '@/types/task'

/**
 * REGRESSION TEST: List Filter Timezone Handling
 *
 * This test verifies the fix for the timezone bug where saved filters
 * weren't showing tasks due today correctly.
 *
 * Bug: useFilterState was using UTC midnight for ALL tasks, regardless
 * of the isAllDay flag, causing timed tasks to be filtered incorrectly.
 *
 * Fix: Now uses applyDateFilter from date-filter-utils.ts which correctly
 * handles timezone for all-day (UTC) vs timed (local) tasks.
 */

// Helper to create a mock task
function createMockTask(
  id: string,
  dueDateTime: string | null,
  isAllDay: boolean,
  completed = false
): Task {
  // `as Task` was hiding ISO strings where `dueDateTime`, `createdAt` and
  // `updatedAt` are all `Date` (AWTD-916). These tests are ABOUT timezone
  // handling, so the difference between a Date and a string it re-parses is
  // exactly the thing they should not be vague on.
  return buildTask({
    id,
    title: `Test Task ${id}`,
    isPrivate: true,
    completed,
    dueDateTime: dueDateTime === null ? null : new Date(dueDateTime),
    isAllDay,
    lists: [buildTaskList({ id: 'test-list', name: 'Test List' })],
  })
}

describe('useFilterState - Timezone Regression Tests', () => {
  beforeEach(() => {
    // Mock current date to Jan 15, 2025 at 10 AM local time
    const mockDate = new Date('2025-01-15T10:00:00.000')
    vi.useFakeTimers()
    vi.setSystemTime(mockDate)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('REGRESSION: "Due Today" Filter with All-Day Tasks', () => {
    it('should show all-day task due today (stored at UTC midnight)', () => {
      const now = new Date()
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      const tasks = [
        createMockTask('all-day-today', todayUTC.toISOString(), true),
        createMockTask('all-day-tomorrow', new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString(), true),
        // Mark yesterday's task as completed so it doesn't appear (overdue incomplete tasks DO appear)
        createMockTask('all-day-yesterday', new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)).toISOString(), true, true)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      // Set "today" filter
      act(() => {
        result.current.setDueDate('today')
      })

      // Apply filters
      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      // Should only show task due today (completed overdue tasks are excluded)
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('all-day-today')
    })

    it('should include overdue incomplete tasks in "today" filter', () => {
      const now = new Date()
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      const yesterdayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))

      const tasks = [
        createMockTask('all-day-today', todayUTC.toISOString(), true, false),
        createMockTask('overdue-incomplete', yesterdayUTC.toISOString(), true, false),
        createMockTask('overdue-completed', yesterdayUTC.toISOString(), true, true)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      act(() => {
        result.current.setDueDate('today')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      // Today filter includes today's tasks AND overdue incomplete tasks
      expect(filtered).toHaveLength(2)
      expect(filtered.map(t => t.id).sort()).toEqual(['all-day-today', 'overdue-incomplete'].sort())
    })

    it('should NOT show all-day task due tomorrow in "today" filter', () => {
      const now = new Date()
      const tomorrowUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))

      const tasks = [
        createMockTask('all-day-tomorrow', tomorrowUTC.toISOString(), true)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      act(() => {
        result.current.setDueDate('today')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      expect(filtered).toHaveLength(0)
    })
  })

  describe('REGRESSION: "Due Today" Filter with Timed Tasks', () => {
    it('should show timed task due today at any time in local timezone', () => {
      const now = new Date()

      // Create tasks for different times today (local timezone)
      const todayAt9AM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0, 0)
      const todayAt2PM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0)
      const todayAt11PM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 0, 0)
      const tomorrowAt9AM = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0)

      const tasks = [
        createMockTask('timed-today-9am', todayAt9AM.toISOString(), false),
        createMockTask('timed-today-2pm', todayAt2PM.toISOString(), false),
        createMockTask('timed-today-11pm', todayAt11PM.toISOString(), false),
        createMockTask('timed-tomorrow-9am', tomorrowAt9AM.toISOString(), false)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      act(() => {
        result.current.setDueDate('today')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      // Should show all three tasks due today (at any time)
      expect(filtered).toHaveLength(3)
      expect(filtered.map(t => t.id).sort()).toEqual([
        'timed-today-9am',
        'timed-today-2pm',
        'timed-today-11pm'
      ].sort())
    })

    it('should NOT show timed task due tomorrow in "today" filter', () => {
      const now = new Date()
      const tomorrowAt2PM = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 14, 0, 0)

      const tasks = [
        createMockTask('timed-tomorrow', tomorrowAt2PM.toISOString(), false)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      act(() => {
        result.current.setDueDate('today')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      expect(filtered).toHaveLength(0)
    })
  })

  describe('REGRESSION: Mixed All-Day and Timed Tasks', () => {
    it('should correctly filter both all-day and timed tasks in "today" filter', () => {
      const now = new Date()

      // All-day task: UTC midnight
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      // Timed task: local timezone
      const todayLocal2PM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 0, 0)

      // Tomorrow tasks
      const tomorrowUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
      const tomorrowLocal2PM = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 14, 0, 0)

      const tasks = [
        createMockTask('all-day-today', todayUTC.toISOString(), true),
        createMockTask('timed-today', todayLocal2PM.toISOString(), false),
        createMockTask('all-day-tomorrow', tomorrowUTC.toISOString(), true),
        createMockTask('timed-tomorrow', tomorrowLocal2PM.toISOString(), false)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      act(() => {
        result.current.setDueDate('today')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      // Should show both tasks due today
      expect(filtered).toHaveLength(2)
      expect(filtered.map(t => t.id).sort()).toEqual([
        'all-day-today',
        'timed-today'
      ].sort())
    })
  })

  describe('REGRESSION: Overdue Filter', () => {
    it('should correctly identify overdue all-day tasks', () => {
      const now = new Date()
      const yesterdayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
      const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      const tasks = [
        createMockTask('overdue-all-day', yesterdayUTC.toISOString(), true, false),
        createMockTask('today-all-day', todayUTC.toISOString(), true, false)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      act(() => {
        result.current.setDueDate('overdue')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('overdue-all-day')
    })

    it('should correctly identify overdue timed tasks', () => {
      const now = new Date() // Mocked to 10 AM
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000)

      const tasks = [
        createMockTask('overdue-timed', oneHourAgo.toISOString(), false, false),
        createMockTask('future-timed', oneHourLater.toISOString(), false, false)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      act(() => {
        result.current.setDueDate('overdue')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('overdue-timed')
    })

    it('should exclude completed tasks from overdue filter', () => {
      const now = new Date()
      const yesterdayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))

      const tasks = [
        createMockTask('overdue-incomplete', yesterdayUTC.toISOString(), true, false),
        createMockTask('overdue-completed', yesterdayUTC.toISOString(), true, true)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      act(() => {
        result.current.setDueDate('overdue')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('overdue-incomplete')
    })
  })

  describe('REGRESSION: iOS/Web Sync Scenarios', () => {
    it('iOS all-day task created for "Today" must show "Today" on web', () => {
      // iOS stores all-day tasks at midnight UTC for the selected date
      const now = new Date()
      const todayMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

      const tasks = [
        createMockTask('ios-all-day-today', todayMidnightUTC.toISOString(), true)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      act(() => {
        result.current.setDueDate('today')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      // Web MUST show the task (not filter it out)
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('ios-all-day-today')
    })

    it('iOS timed task created for "Today 9 PM" must show "Today" on web', () => {
      const now = new Date()
      const today9PM = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0)

      const tasks = [
        createMockTask('ios-timed-today', today9PM.toISOString(), false)
      ]

      const { result } = renderHook(() =>
        useFilterState({
          selectedListId: 'test-list',
          currentList: undefined,
          getManualOrder: () => undefined
        })
      )

      act(() => {
        result.current.setDueDate('today')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, 'user-id', [], true)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('ios-timed-today')
    })
  })
})
