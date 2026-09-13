import { describe, it, expect } from 'vitest'
import { buildTaskList } from '../fixtures/domain'
import { applyListDefaults, mapTaskDataForApi } from '@/lib/task-creation-utils'
import type { TaskList } from '@/types/task'

describe('applyListDefaults', () => {
  const userId = 'user-123'

  // Helper to create a list with specific defaults
  // The literal this replaces was missing `owner`, which TaskList requires.
  const createList = (
    id: string,
    name: string,
    defaults: Partial<TaskList> = {}
  ): TaskList =>
    buildTaskList({ id, name, ownerId: userId, color: '#3b82f6', ...defaults })

  describe('Default Due Time Application', () => {
    it('should apply defaultDueTime when defaultDueDate is set', () => {
      const list = createList('list-1', 'Test List', {
        defaultDueDate: 'today',
        defaultDueTime: '14:30',
      })

      const result = applyListDefaults(
        { title: 'Test Task' },
        list,
        'list-1'
      )

      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        const dueDateTime = typeof result.dueDateTime === 'string' ? new Date(result.dueDateTime) : result.dueDateTime
        expect(dueDateTime.getHours()).toBe(14)
        expect(dueDateTime.getMinutes()).toBe(30)
      }
    })

    it('should apply defaultDueTime even when no defaultDueDate is set', () => {
      const list = createList('list-1', 'Test List', {
        defaultDueDate: 'none',
        defaultDueTime: '15:45',
      })

      const result = applyListDefaults(
        { title: 'Test Task' },
        list,
        'list-1'
      )

      // Should create a date for today with the specified time
      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        const dueDateTime = typeof result.dueDateTime === 'string' ? new Date(result.dueDateTime) : result.dueDateTime
        expect(dueDateTime.getHours()).toBe(15)
        expect(dueDateTime.getMinutes()).toBe(45)

        // Should be today's date
        const today = new Date()
        expect(dueDateTime.getDate()).toBe(today.getDate())
        expect(dueDateTime.getMonth()).toBe(today.getMonth())
        expect(dueDateTime.getFullYear()).toBe(today.getFullYear())
      }
    })

    it('should apply "all day" (null) defaultDueTime and keep date at midnight', () => {
      const list = createList('list-1', 'Test List', {
        defaultDueDate: 'today',
        defaultDueTime: null,
      })

      const result = applyListDefaults(
        { title: 'Test Task' },
        list,
        'list-1'
      )

      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        const dueDateTime = typeof result.dueDateTime === 'string' ? new Date(result.dueDateTime) : result.dueDateTime
        expect(dueDateTime.getHours()).toBe(0)
        expect(dueDateTime.getMinutes()).toBe(0)
        expect(dueDateTime.getSeconds()).toBe(0)
        expect(dueDateTime.getMilliseconds()).toBe(0)
      }
    })

    it('should not apply defaultDueTime if task already has a when date', () => {
      const list = createList('list-1', 'Test List', {
        defaultDueDate: 'today',
        defaultDueTime: '14:30',
      })

      const existingDate = new Date('2025-01-15T10:00:00')
      const result = applyListDefaults(
        { title: 'Test Task', dueDateTime: existingDate },
        list,
        'list-1'
      )

      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        const dueDateTime = typeof result.dueDateTime === 'string' ? new Date(result.dueDateTime) : result.dueDateTime
        // Should preserve the existing time, not apply defaultDueTime
        expect(dueDateTime.getHours()).toBe(10)
        expect(dueDateTime.getMinutes()).toBe(0)
      }
    })

    it('should handle defaultDueTime with defaultDueDate="tomorrow"', () => {
      const list = createList('list-1', 'Test List', {
        defaultDueDate: 'tomorrow',
        defaultDueTime: '09:00',
      })

      const result = applyListDefaults(
        { title: 'Test Task' },
        list,
        'list-1'
      )

      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        const dueDateTime = typeof result.dueDateTime === 'string' ? new Date(result.dueDateTime) : result.dueDateTime
        expect(dueDateTime.getHours()).toBe(9)
        expect(dueDateTime.getMinutes()).toBe(0)

        // Should be tomorrow's date
        const tomorrow = new Date()
        tomorrow.setDate(tomorrow.getDate() + 1)
        expect(dueDateTime.getDate()).toBe(tomorrow.getDate())
        expect(dueDateTime.getMonth()).toBe(tomorrow.getMonth())
      }
    })

    it('should handle defaultDueTime with defaultDueDate="next_week"', () => {
      const list = createList('list-1', 'Test List', {
        defaultDueDate: 'next_week',
        defaultDueTime: '17:00',
      })

      const result = applyListDefaults(
        { title: 'Test Task' },
        list,
        'list-1'
      )

      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        const dueDateTime = typeof result.dueDateTime === 'string' ? new Date(result.dueDateTime) : result.dueDateTime
        expect(dueDateTime.getHours()).toBe(17)
        expect(dueDateTime.getMinutes()).toBe(0)
      }
    })

    it('should not apply defaultDueTime if undefined (no default time set)', () => {
      const list = createList('list-1', 'Test List', {
        defaultDueDate: 'today',
        defaultDueTime: undefined,
      })

      const result = applyListDefaults(
        { title: 'Test Task' },
        list,
        'list-1'
      )

      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        const dueDateTime = typeof result.dueDateTime === 'string' ? new Date(result.dueDateTime) : result.dueDateTime
        // parseRelativeDate('today') returns current time, not midnight
        // Verify it's today's date
        const today = new Date()
        expect(dueDateTime.getDate()).toBe(today.getDate())
        expect(dueDateTime.getMonth()).toBe(today.getMonth())
        expect(dueDateTime.getFullYear()).toBe(today.getFullYear())
      }
    })

    it('should handle edge case: defaultDueTime without defaultDueDate on "today" list', () => {
      const list = createList('list-1', 'Test List', {
        defaultDueDate: 'none',
        defaultDueTime: '10:30',
      })

      const result = applyListDefaults(
        { title: 'Test Task' },
        list,
        'today' // selectedListId is "today"
      )

      // Should apply today's date from selectedListId and the time from list
      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        const dueDateTime = typeof result.dueDateTime === 'string' ? new Date(result.dueDateTime) : result.dueDateTime
        expect(dueDateTime.getHours()).toBe(10)
        expect(dueDateTime.getMinutes()).toBe(30)
      }
    })
  })

  describe('Other Default Fields', () => {
    it('should apply all list defaults correctly', () => {
      const list = createList('list-1', 'Test List', {
        defaultPriority: 2,
        defaultRepeating: 'weekly',
        defaultIsPrivate: false,
        defaultAssigneeId: 'user-456',
        defaultDueDate: 'tomorrow',
        defaultDueTime: '14:00',
      })

      const result = applyListDefaults(
        { title: 'Test Task' },
        list,
        'list-1'
      )

      expect(result.priority).toBe(2)
      expect(result.repeating).toBe('weekly')
      expect(result.isPrivate).toBe(false)
      expect(result.assigneeId).toBe('user-456')
      expect(result.dueDateTime).toBeDefined()
      if (result.dueDateTime) {
        const dueDateTime = typeof result.dueDateTime === 'string' ? new Date(result.dueDateTime) : result.dueDateTime
        expect(dueDateTime.getHours()).toBe(14)
        expect(dueDateTime.getMinutes()).toBe(0)
      }
    })

    it('should respect task data over list defaults', () => {
      const list = createList('list-1', 'Test List', {
        defaultPriority: 2,
        defaultDueTime: '14:00',
      })

      const existingDate = new Date('2025-01-20T09:00:00')
      const result = applyListDefaults(
        {
          title: 'Test Task',
          priority: 3,
          dueDateTime: existingDate,
        },
        list,
        'list-1'
      )

      expect(result.priority).toBe(3) // Task data priority, not list default
      expect(result.dueDateTime).toEqual(existingDate) // Task data dueDateTime, not modified
    })
  })
})

describe('mapTaskDataForApi', () => {
  it('should send dueDateTime field with time preserved', () => {
    const testDate = new Date('2025-01-15T14:30:00')
    const taskData = {
      title: 'Test Task',
      dueDateTime: testDate,
      priority: 1,
      isPrivate: true,
      repeating: 'never' as const,
      listIds: ['list-123'],
    }

    const apiData = mapTaskDataForApi(taskData)

    // Should send dueDateTime (primary field for full datetime support)
    expect(apiData.dueDateTime).toBeDefined()
    expect(apiData.dueDateTime).toEqual(testDate.toISOString())

    // Verify time is preserved
    // `dueDateTime` on the API payload is an ISO string — the assertion two
    // lines up says so — so the `instanceof Date` branch was unreachable.
    const dueDateTime = new Date(apiData.dueDateTime!)
    expect(dueDateTime.getHours()).toBe(14)
    expect(dueDateTime.getMinutes()).toBe(30)
  })

  it('should send dueDateTime not dueDate or when', () => {
    const testDate = new Date('2025-01-15T14:30:00')
    const taskData = {
      title: 'Test Task',
      dueDateTime: testDate,
      priority: 1,
      isPrivate: true,
      repeating: 'never' as const,
      listIds: ['list-123'],
    }

    const apiData = mapTaskDataForApi(taskData)

    // API prefers dueDateTime for full datetime support
    expect(apiData).toHaveProperty('dueDateTime')
    expect(apiData).not.toHaveProperty('dueDate')
    expect(apiData).not.toHaveProperty('when')
  })

  it('should handle undefined when date', () => {
    const taskData = {
      title: 'Test Task',
      priority: 1,
      isPrivate: true,
      repeating: 'never' as const,
      listIds: ['list-123'],
    }

    const apiData = mapTaskDataForApi(taskData)

    expect(apiData.dueDateTime).toBeUndefined()
  })

  it('should map all task fields correctly', () => {
    const testDate = new Date('2025-01-15T14:30:00')
    const taskData = {
      title: 'Test Task',
      description: 'Test Description',
      dueDateTime: testDate,
      isAllDay: false,
      priority: 2,
      isPrivate: false,
      repeating: 'weekly' as const,
      listIds: ['list-123', 'list-456'],
      assigneeId: 'user-789',
    }

    const apiData = mapTaskDataForApi(taskData)

    expect(apiData).toEqual({
      title: 'Test Task',
      description: 'Test Description',
      dueDateTime: testDate.toISOString(), // dueDateTime field for full datetime support
      isAllDay: false,
      priority: 2,
      isPrivate: false,
      repeating: 'weekly',
      customRepeatingData: null,
      listIds: ['list-123', 'list-456'],
      assigneeId: 'user-789',
    })
  })
})
