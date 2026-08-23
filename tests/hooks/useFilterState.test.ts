import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFilterState } from '@/hooks/useFilterState'

// Mock the localStorage hook
vi.mock('@/hooks/useLocalStorage', () => ({
  useMyTasksFilters: () => ({
    filters: {
      search: '',
      completed: 'all',
      priority: [],
      assignee: [],
      dueDate: 'all',
      sortBy: 'auto'
    },
    setFilters: vi.fn(),
    clearFilters: vi.fn()
  })
}))

const mockTasks = [
  {
    id: '1',
    title: 'High priority task',
    description: 'Important task',
    completed: false,
    priority: 3,
    assignee: { id: 'user-1', name: 'John' },
    assigneeId: 'user-1',
    creatorId: 'user-1',
    dueDate: '2024-12-01T00:00:00Z',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    lists: [{ id: 'list-1', name: 'List 1' }]
  },
  {
    id: '2', 
    title: 'Completed task',
    description: 'Done task',
    completed: true,
    priority: 1,
    assignee: null,
    assigneeId: null,
    creatorId: 'user-1',
    dueDate: null,
    createdAt: new Date('2024-01-02'),
    updatedAt: new Date('2024-01-02'),
    lists: [{ id: 'list-1', name: 'List 1' }]
  }
]

const mockLists = [
  {
    id: 'list-1',
    name: 'List 1',
    privacy: 'PRIVATE',
    ownerId: 'user-1',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01')
  }
]

describe('useFilterState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should provide filter state and operations', () => {
    const { result } = renderHook(() => useFilterState({
      selectedListId: 'my-tasks'
    }))

    expect(result.current.filters).toBeDefined()
    expect(result.current.hasActiveFilters).toBeDefined()
    expect(result.current.setSearch).toBeDefined()
    expect(result.current.setCompleted).toBeDefined()
    expect(result.current.setPriority).toBeDefined()
    expect(result.current.setAssignee).toBeDefined()
    expect(result.current.setDueDate).toBeDefined()
    expect(result.current.setSortBy).toBeDefined()
    expect(result.current.clearAllFilters).toBeDefined()
    expect(result.current.applyFiltersToTasks).toBeDefined()
  })

  it('should filter tasks by search term', () => {
    const { result } = renderHook(() => useFilterState({
      selectedListId: 'list-1'
    }))

    act(() => {
      result.current.setSearch('important')
    })

    const filteredTasks = result.current.applyFiltersToTasks(mockTasks, 'user-1', mockLists, true)
    expect(filteredTasks).toHaveLength(1)
    expect(filteredTasks[0].title).toBe('High priority task')
  })

  it('should filter tasks by completion status', () => {
    const { result } = renderHook(() => useFilterState({
      selectedListId: 'list-1'
    }))

    act(() => {
      result.current.setCompleted('completed')
    })

    const filteredTasks = result.current.applyFiltersToTasks(mockTasks, 'user-1', mockLists, true)
    expect(filteredTasks).toHaveLength(1)
    expect(filteredTasks[0].completed).toBe(true)
  })

  it('should filter tasks by priority', () => {
    const { result } = renderHook(() => useFilterState({
      selectedListId: 'list-1'
    }))

    act(() => {
      result.current.setPriority([3])
    })

    const filteredTasks = result.current.applyFiltersToTasks(mockTasks, 'user-1', mockLists, true)
    expect(filteredTasks).toHaveLength(1)
    expect(filteredTasks[0].priority).toBe(3)
  })

  it('should detect active filters', () => {
    const { result } = renderHook(() => useFilterState({
      selectedListId: 'list-1'  
    }))

    // Initially no active filters
    expect(result.current.hasActiveFilters).toBe(false)

    // After setting a filter
    act(() => {
      result.current.setSearch('test')
    })

    expect(result.current.hasActiveFilters).toBe(true)
  })

  it('should clear all filters', () => {
    const { result } = renderHook(() => useFilterState({
      selectedListId: 'list-1'
    }))

    // Set some filters
    act(() => {
      result.current.setSearch('test')
      result.current.setCompleted('completed')
    })

    expect(result.current.hasActiveFilters).toBe(true)

    // Clear all filters
    act(() => {
      result.current.clearAllFilters()
    })

    expect(result.current.hasActiveFilters).toBe(false)
  })

  describe('default filter (Incomplete + Recently completed)', () => {
    const now = new Date()
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
    const twentyFiveHoursAgo = new Date(now.getTime() - 25 * 60 * 60 * 1000)

    const mockTasksWithTiming = [
      {
        id: '1',
        title: 'Incomplete task',
        description: 'Active task',
        completed: false,
        priority: 1,
        assignee: null,
        assigneeId: null,
        creatorId: 'user-1',
        dueDate: null,
        createdAt: now,
        updatedAt: now,
        lists: [{ id: 'list-1', name: 'List 1' }]
      },
      {
        id: '2',
        title: 'Recently completed task',
        description: 'Just finished',
        completed: true,
        priority: 1,
        assignee: null,
        assigneeId: null,
        creatorId: 'user-1',
        dueDate: null,
        createdAt: fiveMinutesAgo,
        updatedAt: fiveMinutesAgo,
        lists: [{ id: 'list-1', name: 'List 1' }]
      },
      {
        id: '3',
        title: 'Completed 2 hours ago',
        description: 'Finished a while ago',
        completed: true,
        priority: 1,
        assignee: null,
        assigneeId: null,
        creatorId: 'user-1',
        dueDate: null,
        createdAt: twoHoursAgo,
        updatedAt: twoHoursAgo,
        lists: [{ id: 'list-1', name: 'List 1' }]
      },
      {
        id: '4',
        title: 'Old completed task',
        description: 'Completed long ago',
        completed: true,
        priority: 1,
        assignee: null,
        assigneeId: null,
        creatorId: 'user-1',
        dueDate: null,
        createdAt: twentyFiveHoursAgo,
        updatedAt: twentyFiveHoursAgo,
        lists: [{ id: 'list-1', name: 'List 1' }]
      }
    ]

    it('should show incomplete tasks with default filter', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      act(() => {
        result.current.setCompleted('default')
      })

      const filteredTasks = result.current.applyFiltersToTasks(mockTasksWithTiming, 'user-1', mockLists, true)
      const incompleteTasks = filteredTasks.filter(task => !task.completed)
      expect(incompleteTasks).toHaveLength(1)
      expect(incompleteTasks[0].title).toBe('Incomplete task')
    })

    it('should show recently completed tasks (within 24 hours) with default filter', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      act(() => {
        result.current.setCompleted('default')
      })

      const filteredTasks = result.current.applyFiltersToTasks(mockTasksWithTiming, 'user-1', mockLists, true)
      const recentlyCompletedTasks = filteredTasks.filter(task => task.completed)
      // Should show both 5 min ago and 2 hours ago
      expect(recentlyCompletedTasks).toHaveLength(2)
      expect(recentlyCompletedTasks.some(t => t.title === 'Recently completed task')).toBe(true)
      expect(recentlyCompletedTasks.some(t => t.title === 'Completed 2 hours ago')).toBe(true)
    })

    it('should hide old completed tasks (older than 24 hours) with default filter', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      act(() => {
        result.current.setCompleted('default')
      })

      const filteredTasks = result.current.applyFiltersToTasks(mockTasksWithTiming, 'user-1', mockLists, true)
      const oldCompletedTasks = filteredTasks.filter(task => task.title === 'Old completed task')
      expect(oldCompletedTasks).toHaveLength(0)
    })

    it('should show both incomplete and recently completed tasks with default filter', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      act(() => {
        result.current.setCompleted('default')
      })

      const filteredTasks = result.current.applyFiltersToTasks(mockTasksWithTiming, 'user-1', mockLists, true)
      expect(filteredTasks).toHaveLength(3)
      expect(filteredTasks.some(task => task.title === 'Incomplete task')).toBe(true)
      expect(filteredTasks.some(task => task.title === 'Recently completed task')).toBe(true)
      expect(filteredTasks.some(task => task.title === 'Completed 2 hours ago')).toBe(true)
      expect(filteredTasks.some(task => task.title === 'Old completed task')).toBe(false)
    })

    it('should use "default" as the default filter value', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      // Check that the default completion filter is "default"
      expect(result.current.filters.completed).toBe('default')
    })

    it('should not consider "default" as an active filter', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      // With default filter, should not be considered active
      expect(result.current.hasActiveFilters).toBe(false)

      // After changing to a different filter, should be active
      act(() => {
        result.current.setCompleted('all')
      })

      expect(result.current.hasActiveFilters).toBe(true)
    })
  })

  describe('Auto Sort', () => {
    it('should put completed tasks at the bottom with auto sort', () => {
      const tasksForSorting = [
        {
          id: '1',
          title: 'Incomplete low priority',
          description: '',
          completed: false,
          priority: 1,
          assignee: null,
          assigneeId: null,
          creatorId: 'user-1',
          dueDateTime: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          lists: [{ id: 'list-1', name: 'List 1' }]
        },
        {
          id: '2',
          title: 'Completed high priority',
          description: '',
          completed: true,
          priority: 3,
          assignee: null,
          assigneeId: null,
          creatorId: 'user-1',
          dueDateTime: null,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
          lists: [{ id: 'list-1', name: 'List 1' }]
        },
        {
          id: '3',
          title: 'Incomplete high priority',
          description: '',
          completed: false,
          priority: 3,
          assignee: null,
          assigneeId: null,
          creatorId: 'user-1',
          dueDateTime: null,
          createdAt: new Date('2024-01-03'),
          updatedAt: new Date('2024-01-03'),
          lists: [{ id: 'list-1', name: 'List 1' }]
        }
      ]

      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      // Ensure we're using auto sort
      act(() => {
        result.current.setSortBy('auto')
        result.current.setCompleted('all') // Show all tasks including completed
      })

      const sortedTasks = result.current.applyFiltersToTasks(tasksForSorting, 'user-1', mockLists, true)

      // Completed tasks should be at the bottom, regardless of priority
      // Expected order: incomplete high priority, incomplete low priority, completed high priority
      expect(sortedTasks[0].id).toBe('3') // Incomplete, high priority
      expect(sortedTasks[1].id).toBe('1') // Incomplete, low priority
      expect(sortedTasks[2].id).toBe('2') // Completed (at bottom)
    })

    it('should sort by priority within incomplete tasks', () => {
      const tasksForSorting = [
        {
          id: '1',
          title: 'Low priority',
          description: '',
          completed: false,
          priority: 1,
          assignee: null,
          assigneeId: null,
          creatorId: 'user-1',
          dueDateTime: null,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          lists: [{ id: 'list-1', name: 'List 1' }]
        },
        {
          id: '2',
          title: 'High priority',
          description: '',
          completed: false,
          priority: 3,
          assignee: null,
          assigneeId: null,
          creatorId: 'user-1',
          dueDateTime: null,
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
          lists: [{ id: 'list-1', name: 'List 1' }]
        },
        {
          id: '3',
          title: 'Medium priority',
          description: '',
          completed: false,
          priority: 2,
          assignee: null,
          assigneeId: null,
          creatorId: 'user-1',
          dueDateTime: null,
          createdAt: new Date('2024-01-03'),
          updatedAt: new Date('2024-01-03'),
          lists: [{ id: 'list-1', name: 'List 1' }]
        }
      ]

      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      act(() => {
        result.current.setSortBy('auto')
      })

      const sortedTasks = result.current.applyFiltersToTasks(tasksForSorting, 'user-1', mockLists, true)

      // Should be sorted by priority (highest first)
      expect(sortedTasks[0].id).toBe('2') // High priority (3)
      expect(sortedTasks[1].id).toBe('3') // Medium priority (2)
      expect(sortedTasks[2].id).toBe('1') // Low priority (1)
    })

    it('should sort by due date within same priority', () => {
      const tasksForSorting = [
        {
          id: '1',
          title: 'Later due date',
          description: '',
          completed: false,
          priority: 2,
          assignee: null,
          assigneeId: null,
          creatorId: 'user-1',
          dueDateTime: '2024-12-31T00:00:00Z',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
          lists: [{ id: 'list-1', name: 'List 1' }]
        },
        {
          id: '2',
          title: 'Earlier due date',
          description: '',
          completed: false,
          priority: 2,
          assignee: null,
          assigneeId: null,
          creatorId: 'user-1',
          dueDateTime: '2024-06-15T00:00:00Z',
          createdAt: new Date('2024-01-02'),
          updatedAt: new Date('2024-01-02'),
          lists: [{ id: 'list-1', name: 'List 1' }]
        },
        {
          id: '3',
          title: 'No due date',
          description: '',
          completed: false,
          priority: 2,
          assignee: null,
          assigneeId: null,
          creatorId: 'user-1',
          dueDateTime: null,
          createdAt: new Date('2024-01-03'),
          updatedAt: new Date('2024-01-03'),
          lists: [{ id: 'list-1', name: 'List 1' }]
        }
      ]

      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      act(() => {
        result.current.setSortBy('auto')
      })

      const sortedTasks = result.current.applyFiltersToTasks(tasksForSorting, 'user-1', mockLists, true)

      // Should be sorted by due date (earlier first, no date at end)
      expect(sortedTasks[0].id).toBe('2') // Earlier due date
      expect(sortedTasks[1].id).toBe('1') // Later due date
      expect(sortedTasks[2].id).toBe('3') // No due date (at end)
    })
  })

  describe('Universal Search', () => {
    it('leaves server-selected grammar and comment matches intact', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      act(() => {
        result.current.setSearch('status:doing')
      })

      const filteredTasks = result.current.applyFiltersToTasks(
        mockTasks,
        'user-1',
        mockLists,
        false,
        false,
        true,
      )

      expect(filteredTasks).toHaveLength(2)
    })

    it('should show ALL tasks (completed and incomplete) during search', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      // Set search query - this should trigger universal search
      act(() => {
        result.current.setSearch('task')
      })

      const filteredTasks = result.current.applyFiltersToTasks(mockTasks, 'user-1', mockLists, true)

      // Should return both completed and incomplete tasks
      expect(filteredTasks).toHaveLength(2)
      expect(filteredTasks.some(t => t.completed)).toBe(true)
      expect(filteredTasks.some(t => !t.completed)).toBe(true)
    })

    it('should search across all accessible tasks, not just current list', () => {
      const tasksInMultipleLists = [
        {
          id: '1',
          title: 'Task in list 1',
          description: '',
          completed: false,
          priority: 1,
          assigneeId: 'user-1',
          creatorId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          lists: [{ id: 'list-1', name: 'List 1' }]
        },
        {
          id: '2',
          title: 'Task in list 2',
          description: '',
          completed: false,
          priority: 1,
          assigneeId: 'user-1',
          creatorId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          lists: [{ id: 'list-2', name: 'List 2' }]
        }
      ]

      const multipleLists = [
        {
          id: 'list-1',
          name: 'List 1',
          privacy: 'PRIVATE',
          ownerId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'list-2',
          name: 'List 2',
          privacy: 'PRIVATE',
          ownerId: 'user-1',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]

      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      // Set search query - should search universally
      act(() => {
        result.current.setSearch('Task')
      })

      const filteredTasks = result.current.applyFiltersToTasks(tasksInMultipleLists, 'user-1', multipleLists, false)

      // Should return tasks from BOTH lists, not just list-1
      expect(filteredTasks).toHaveLength(2)
      expect(filteredTasks.some(t => t.lists[0].id === 'list-1')).toBe(true)
      expect(filteredTasks.some(t => t.lists[0].id === 'list-2')).toBe(true)
    })

    it('should include old completed tasks in universal search', () => {
      const oldCompletedTask = {
        id: '3',
        title: 'Old completed task',
        description: '',
        completed: true,
        priority: 1,
        assigneeId: 'user-1',
        creatorId: 'user-1',
        createdAt: new Date('2020-01-01'),
        updatedAt: new Date('2020-01-01'), // Very old completed task
        lists: [{ id: 'list-1', name: 'List 1' }]
      }

      const tasksWithOldCompleted = [...mockTasks, oldCompletedTask]

      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      // Set search query
      act(() => {
        result.current.setSearch('task')
      })

      const filteredTasks = result.current.applyFiltersToTasks(tasksWithOldCompleted, 'user-1', mockLists, true)

      // Should include the old completed task (normally hidden by default filter)
      const oldTask = filteredTasks.find(t => t.id === '3')
      expect(oldTask).toBeDefined()
      expect(oldTask?.completed).toBe(true)
    })
  })
})