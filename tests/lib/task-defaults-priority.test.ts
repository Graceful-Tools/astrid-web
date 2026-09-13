import { describe, it, expect } from 'vitest'
import { buildTaskList } from '../fixtures/domain'
import { applyTaskDefaultsWithPriority, SYSTEM_DEFAULTS } from '@/lib/task-defaults-priority'
import type { TaskList } from '@/types/task'

describe('Task Defaults Priority Logic', () => {
  const userId = 'user-123'

  // Helper to create a list with specific defaults
  // The literal this replaces was missing `owner`, which TaskList requires.
  const createList = (
    id: string,
    name: string,
    defaults: Partial<TaskList> = {}
  ): TaskList =>
    buildTaskList({ id, name, ownerId: userId, color: '#3b82f6', ...defaults })

  describe('System Defaults (No Customization)', () => {
    it('should use system defaults when no lists or explicit values', () => {
      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: null,
        hashtagLists: [],
        userId,
      })

      expect(result.priority).toBe(SYSTEM_DEFAULTS.priority) // 0
      expect(result.assigneeId).toBe(userId) // Task creator
      expect(result.isPrivate).toBe(SYSTEM_DEFAULTS.isPrivate) // true
      expect(result.repeating).toBe(SYSTEM_DEFAULTS.repeating) // 'never'
      expect(result.dueDateTime).toBeUndefined()
    })

    it('should treat "unassigned" as a customized default (not system default)', () => {
      const currentList = createList('list-1', 'Default List', {
        defaultPriority: 0,
        defaultAssigneeId: 'unassigned', // This is a customized default!
        defaultIsPrivate: true,
        defaultRepeating: 'never',
        defaultDueDate: 'none',
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [],
        userId,
      })

      expect(result.priority).toBe(0)
      expect(result.assigneeId).toBe(null) // Should apply "unassigned" (null), not fall back to creator
    })

    it('should respect "unassigned" default assignee even with other customized defaults', () => {
      const currentList = createList('list-1', 'Test List', {
        defaultPriority: 3, // Customized
        defaultAssigneeId: 'unassigned', // Explicitly unassigned
        defaultIsPrivate: false, // Customized
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {}, // No explicit values
        currentList,
        hashtagLists: [],
        userId,
      })

      expect(result.priority).toBe(3)
      expect(result.assigneeId).toBe(null) // Must be null, NOT userId
      expect(result.isPrivate).toBe(false)
    })

    it('should not confuse undefined parsedValues.assigneeId with explicit unassigned', () => {
      const currentList = createList('list-1', 'Test List', {
        defaultAssigneeId: 'unassigned',
      })

      // When parseTaskInput doesn't find an assignee mention, it returns undefined
      const result = applyTaskDefaultsWithPriority({
        parsedValues: {
          assigneeId: undefined, // Not explicitly set in title
        },
        currentList,
        hashtagLists: [],
        userId,
      })

      // Should apply list default "unassigned", NOT fall back to userId
      expect(result.assigneeId).toBe(null)
    })
  })

  describe('Hashtag List Defaults (Lowest Priority)', () => {
    it('should apply hashtag list customized priority when current list is default', () => {
      const currentList = createList('my-tasks', 'My Tasks', {
        defaultPriority: 0, // System default
      })

      const hashtagList = createList('bob', 'Bob', {
        defaultPriority: 2, // Customized (!!)
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [hashtagList],
        userId,
      })

      expect(result.priority).toBe(2) // From hashtag list
    })

    it('should apply first hashtag list defaults when multiple hashtags', () => {
      const hashtagList1 = createList('list-1', 'Shopping', {
        defaultPriority: 2,
      })

      const hashtagList2 = createList('list-2', 'Work', {
        defaultPriority: 3,
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: null,
        hashtagLists: [hashtagList1, hashtagList2],
        userId,
      })

      expect(result.priority).toBe(2) // From first hashtag list
    })

    it('should not apply hashtag list defaults if they are system defaults', () => {
      const hashtagList = createList('list-1', 'Shopping', {
        defaultPriority: 0, // System default, not customized
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: null,
        hashtagLists: [hashtagList],
        userId,
      })

      expect(result.priority).toBe(0) // Still 0, but from system default, not hashtag list
    })
  })

  describe('Hashtag List Priority Over Current List', () => {
    it('should apply hashtag list priority over current list priority (user explicitly chose hashtag)', () => {
      const currentList = createList('bob', 'Bob', {
        defaultPriority: 2, // Customized (!!)
      })

      const hashtagList = createList('work', 'Work', {
        defaultPriority: 1, // Customized (!) - user explicitly typed #work
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [hashtagList],
        userId,
      })

      expect(result.priority).toBe(1) // Hashtag list wins - explicit choice!
    })

    it('should not apply current list defaults if they are system defaults', () => {
      const currentList = createList('list-1', 'Current', {
        defaultPriority: 0, // System default
      })

      const hashtagList = createList('list-2', 'Hashtag', {
        defaultPriority: 2, // Customized
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [hashtagList],
        userId,
      })

      expect(result.priority).toBe(2) // Hashtag list wins because current list is at default
    })
  })

  describe('Explicit Parsed Values (Highest Priority)', () => {
    it('should apply explicit priority over all list defaults', () => {
      const currentList = createList('bob', 'Bob', {
        defaultPriority: 2,
      })

      const hashtagList = createList('work', 'Work', {
        defaultPriority: 1,
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {
          priority: 3, // "highest priority" in title
        },
        currentList,
        hashtagLists: [hashtagList],
        userId,
      })

      expect(result.priority).toBe(3) // Explicit mention wins
    })

    it('should apply explicit assignee over list defaults', () => {
      const currentList = createList('list-1', 'Current', {
        defaultAssigneeId: 'bob-id',
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {
          assigneeId: 'alice-id', // "assign to alice" in title
        },
        currentList,
        hashtagLists: [],
        userId,
      })

      expect(result.assigneeId).toBe('alice-id') // Explicit mention wins
    })

    it('should apply explicit date over list defaults', () => {
      const currentList = createList('list-1', 'Current', {
        defaultDueDate: 'tomorrow',
      })

      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {
          dueDateTime: tomorrow, // "tomorrow" parsed from title
        },
        currentList,
        hashtagLists: [],
        userId,
      })

      expect(result.dueDateTime).toBeDefined()
    })
  })

  describe('Complex Scenarios', () => {
    it('Scenario 1: User in "bob" (priority=2) adds "Buy milk"', () => {
      const currentList = createList('bob', 'Bob', {
        defaultPriority: 2,
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [],
        userId,
      })

      expect(result.priority).toBe(2)
    })

    it('Scenario 2: User in "My Tasks" (priority=0) adds "Buy milk #bob"', () => {
      const currentList = createList('my-tasks', 'My Tasks', {
        defaultPriority: 0, // Default
      })

      const hashtagList = createList('bob', 'Bob', {
        defaultPriority: 2, // Customized
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [hashtagList],
        userId,
      })

      expect(result.priority).toBe(2) // From #bob
    })

    it('Scenario 3: User in "bob" (priority=2) adds "Buy milk highest priority"', () => {
      const currentList = createList('bob', 'Bob', {
        defaultPriority: 2,
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {
          priority: 3, // Explicit
        },
        currentList,
        hashtagLists: [],
        userId,
      })

      expect(result.priority).toBe(3) // Explicit wins
    })

    it('Scenario 4: User in "bob" (priority=2) adds "Buy milk #work"', () => {
      const currentList = createList('bob', 'Bob', {
        defaultPriority: 2,
      })

      const hashtagList = createList('work', 'Work', {
        defaultPriority: 1,
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [hashtagList],
        userId,
      })

      expect(result.priority).toBe(1) // Hashtag list wins - user explicitly chose #work
    })

    it('Scenario 5: User in "My Tasks" adds "Buy milk" (all defaults)', () => {
      const currentList = createList('my-tasks', 'My Tasks', {
        defaultPriority: 0,
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [],
        userId,
      })

      expect(result.priority).toBe(0) // System default
    })
  })

  describe('All Fields Integration', () => {
    it('should handle all fields with mixed priorities', () => {
      const currentList = createList('current', 'Current', {
        defaultPriority: 2, // Customized - should win
        defaultAssigneeId: 'bob-id', // Customized - should win
        defaultIsPrivate: false, // Customized - should be overridden by explicit
      })

      const hashtagList = createList('hashtag', 'Hashtag', {
        defaultPriority: 1, // Customized but lower priority
        defaultRepeating: 'daily', // Customized - should win (not in current list)
      })

      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {
          isPrivate: true, // Explicit - should win
          dueDateTime: tomorrow, // Explicit - should win
        },
        currentList,
        hashtagLists: [hashtagList],
        userId,
      })

      expect(result.priority).toBe(1) // From hashtag list (wins over current)
      expect(result.assigneeId).toBe('bob-id') // From current list (hashtag doesn't have it)
      expect(result.isPrivate).toBe(true) // Explicit (wins over both)
      expect(result.repeating).toBe('daily') // From hashtag list
      expect(result.dueDateTime).toBeDefined() // Explicit
    })
  })

  describe('Default When Time (All Day vs Specific Time)', () => {
    it('should apply "all day" (null) default time and keep date at midnight', () => {
      const currentList = createList('list-1', 'Test List', {
        defaultDueDate: 'today',
        defaultDueTime: null, // "All day" - explicit null
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [],
        userId,
      })

      expect(result.dueTime).toBe(null) // "All day" should be preserved
      expect(result.dueDateTime).toBeDefined() // Should have a date
      if (result.dueDateTime) {
        expect(result.dueDateTime.getHours()).toBe(0) // Midnight
        expect(result.dueDateTime.getMinutes()).toBe(0)
        expect(result.dueDateTime.getSeconds()).toBe(0)
        expect(result.dueDateTime.getMilliseconds()).toBe(0)
      }
    })

    it('should apply specific time (HH:MM) default time to date', () => {
      const currentList = createList('list-1', 'Test List', {
        defaultDueDate: 'today',
        defaultDueTime: '14:30', // 2:30 PM
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [],
        userId,
      })

      expect(result.dueTime).toBe('14:30')
      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        expect(result.dueDateTime.getHours()).toBe(14)
        expect(result.dueDateTime.getMinutes()).toBe(30)
      }
    })

    it('should distinguish "no default time" (undefined) from "all day" (null)', () => {
      const listWithNoTime = createList('list-1', 'No Default Time', {
        defaultDueDate: 'today',
        defaultDueTime: undefined, // No default time set
      })

      const listWithAllDay = createList('list-2', 'All Day Default', {
        defaultDueDate: 'today',
        defaultDueTime: null, // "All day" explicit
      })

      const resultNoTime = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: listWithNoTime,
        hashtagLists: [],
        userId,
      })

      const resultAllDay = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: listWithAllDay,
        hashtagLists: [],
        userId,
      })

      expect(resultNoTime.dueTime).toBeUndefined() // No time set
      expect(resultAllDay.dueTime).toBe(null) // "All day" set
    })

    it('should apply hashtag list "all day" default time over current list', () => {
      const currentList = createList('current', 'Current', {
        defaultDueDate: 'today',
        defaultDueTime: '09:00', // 9 AM
      })

      const hashtagList = createList('hashtag', 'Hashtag', {
        defaultDueDate: 'tomorrow',
        defaultDueTime: null, // "All day" - should win
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [hashtagList],
        userId,
      })

      expect(result.dueTime).toBe(null) // Hashtag list's "all day" wins
      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        expect(result.dueDateTime.getHours()).toBe(0) // Should be midnight
        expect(result.dueDateTime.getMinutes()).toBe(0)
      }
    })

    it('should handle time without date - default to today at specified time', () => {
      const currentList = createList('list-1', 'Test List', {
        defaultDueDate: 'none', // No date
        defaultDueTime: '15:45', // But has time
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList,
        hashtagLists: [],
        userId,
      })

      expect(result.dueTime).toBe('15:45')
      // When no date is set, time defaults create a date at today
      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        expect(result.dueDateTime.getHours()).toBe(15)
        expect(result.dueDateTime.getMinutes()).toBe(45)
      }
    })
  })

  describe('My Tasks Filter-Aware Defaults', () => {
    it('should apply My Tasks priority filter default when exactly one priority is selected', () => {
      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: null, // My Tasks view
        hashtagLists: [],
        userId,
        myTasksFilters: {
          priority: [2], // Filter set to "!!"
          dueDate: 'all',
        },
      })

      expect(result.priority).toBe(2) // Should use filter priority
    })

    it('should not apply My Tasks priority filter when multiple priorities are selected', () => {
      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: null,
        hashtagLists: [],
        userId,
        myTasksFilters: {
          priority: [1, 2], // Multiple priorities selected
          dueDate: 'all',
        },
      })

      expect(result.priority).toBe(0) // Should use system default
    })

    it('should apply My Tasks date filter default for "today"', () => {
      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: null,
        hashtagLists: [],
        userId,
        myTasksFilters: {
          priority: [],
          dueDate: 'today',
        },
      })

      expect(result.dueDateTime).toBeDefined()
      expect(result.isAllDay).toBe(true)
      if (result.dueDateTime) {
        const today = new Date()
        expect(result.dueDateTime.getDate()).toBe(today.getDate())
        expect(result.dueDateTime.getMonth()).toBe(today.getMonth())
        expect(result.dueDateTime.getFullYear()).toBe(today.getFullYear())
      }
    })

    it('should apply My Tasks date filter default for "this_week"', () => {
      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: null,
        hashtagLists: [],
        userId,
        myTasksFilters: {
          priority: [],
          dueDate: 'this_week',
        },
      })

      expect(result.dueDateTime).toBeDefined()
      expect(result.isAllDay).toBe(true)
      if (result.dueDateTime) {
        // Should be Friday of this week
        const today = new Date()
        const dayOfWeek = today.getDay()
        const daysUntilFriday = (5 - dayOfWeek + 7) % 7
        const expectedDate = new Date(today)
        expectedDate.setDate(today.getDate() + (daysUntilFriday || 7))
        expect(result.dueDateTime.getDate()).toBe(expectedDate.getDate())
      }
    })

    it('should not apply My Tasks filter defaults when in a regular list', () => {
      const currentList = createList('work', 'Work', {
        defaultPriority: 0, // System default
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList, // NOT My Tasks
        hashtagLists: [],
        userId,
        myTasksFilters: {
          priority: [2],
          dueDate: 'today',
        },
      })

      // Should ignore My Tasks filters when in a list
      expect(result.priority).toBe(0)
      expect(result.dueDateTime).toBeUndefined()
    })

    it('should not apply My Tasks filter defaults when using hashtags', () => {
      const hashtagList = createList('work', 'Work', {
        defaultPriority: 0,
      })

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: null,
        hashtagLists: [hashtagList], // User typed #work
        userId,
        myTasksFilters: {
          priority: [2],
          dueDate: 'today',
        },
      })

      // Should ignore My Tasks filters when hashtag is used
      expect(result.priority).toBe(0)
      expect(result.dueDateTime).toBeUndefined()
    })

    it('should apply both priority and date filter defaults from My Tasks', () => {
      const result = applyTaskDefaultsWithPriority({
        parsedValues: {},
        currentList: null,
        hashtagLists: [],
        userId,
        myTasksFilters: {
          priority: [2],
          dueDate: 'today',
        },
      })

      expect(result.priority).toBe(2)
      expect(result.dueDateTime).toBeDefined()
      expect(result.isAllDay).toBe(true)
    })

    it('should allow explicit values to override My Tasks filter defaults', () => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)

      const result = applyTaskDefaultsWithPriority({
        parsedValues: {
          priority: 3, // Explicit "highest priority"
          dueDateTime: tomorrow, // Explicit "tomorrow"
        },
        currentList: null,
        hashtagLists: [],
        userId,
        myTasksFilters: {
          priority: [2],
          dueDate: 'today',
        },
      })

      // Explicit values should win
      expect(result.priority).toBe(3)
      expect(result.dueDateTime).toBeDefined()
      expect(result.dueDateTime?.getDate()).toBe(tomorrow.getDate())
    })

    it('should not apply date filter defaults for "all", "no_date", or "overdue"', () => {
      const testCases = ['all', 'no_date', 'overdue']

      testCases.forEach((filterValue) => {
        const result = applyTaskDefaultsWithPriority({
          parsedValues: {},
          currentList: null,
          hashtagLists: [],
          userId,
          myTasksFilters: {
            priority: [],
            dueDate: filterValue,
          },
        })

        expect(result.dueDateTime).toBeUndefined()
      })
    })
  })
})
