import { renderHook, act } from '@testing-library/react'
import { buildTask, buildTaskList, buildUser } from '../fixtures/domain'
import { useFilterState } from '@/hooks/useFilterState'
import type { Task, TaskList } from '@/types/task'

describe('useFilterState - Deleted List References', () => {
  const mockUserId = 'user-1'

  // Rebuilt on the builder (AWTD-916). The literal it replaces carried four
  // kinds of drift: `filterAssignee`/`filterPriority`/`filterInLists` are
  // `string | null` and were given `[]`; `aiAgentsEnabled` is `string[] | null`
  // and was given `false`; `mcpAccessLevel` and `defaultDueDate` are optional
  // unions with no null member; and `aiAstridEnabled`, `aiAgentConfiguredBy`
  // and `_count` are not fields of TaskList at all. Only `privacy` and `id`
  // matter to applyFiltersToTasks, which is what these tests exercise.
  const mockLists: TaskList[] = [
    buildTaskList({
      id: 'list-1',
      name: 'Active List',
      description: '',
      color: '#4f46e5',
      privacy: 'PRIVATE',
      ownerId: mockUserId,
      owner: buildUser({ id: mockUserId, name: 'User', email: 'user@test.com' }),
      defaultPriority: 0,
      defaultRepeating: 'never',
      defaultIsPrivate: false,
      filterCompletion: 'default',
      filterDueDate: 'all',
      filterAssignee: null,
      filterAssignedBy: null,
      filterRepeating: 'all',
      filterPriority: null,
      filterInLists: null,
      sortBy: 'auto',
      isVirtual: false,
      admins: [],
      members: [],
      listMembers: [],
      mcpEnabled: false,
      aiAgentsEnabled: null,
    }),
  ]

  const createMockTask = (overrides: Partial<Task> = {}): Task =>
    buildTask({
      id: 'task-1',
      title: 'Test Task',
      creatorId: mockUserId,
      assigneeId: null,
      dueDateTime: null,
      creator: buildUser({ id: mockUserId, name: 'User', email: 'user@test.com' }),
      assignee: null,
      ...overrides,
    })

  describe('Filtering tasks with deleted list references', () => {
    it('should handle tasks with null list references without crashing', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      // Create a task with a null list reference (simulating deleted list)
      const taskWithNullList = createMockTask({
        lists: [
          null as any, // Deleted list reference
          { id: 'list-1', name: 'Active List', color: '#4f46e5' }
        ]
      })

      const tasks = [taskWithNullList]

      // This should not throw an error
      expect(() => {
        result.current.applyFiltersToTasks(tasks, mockUserId, mockLists)
      }).not.toThrow()
    })

    it('should filter out null list references when rendering task lists', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      const taskWithMixedLists = createMockTask({
        lists: [
          null as any, // Deleted list
          { id: 'list-1', name: 'Active List', color: '#4f46e5' },
          null as any, // Another deleted list
          { id: 'list-2', name: 'Another List', color: '#10b981' }
        ]
      })

      const tasks = [taskWithMixedLists]
      const filtered = result.current.applyFiltersToTasks(tasks, mockUserId, mockLists)

      // Task should still be included if it has at least one valid list
      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('task-1')
    })

    it('should handle tasks where all list references are deleted', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      const taskWithAllDeletedLists = createMockTask({
        lists: [
          null as any,
          undefined as any,
          null as any
        ]
      })

      const tasks = [taskWithAllDeletedLists]
      const filtered = result.current.applyFiltersToTasks(tasks, mockUserId, mockLists)

      // Task should be filtered out since it has no valid list references
      expect(filtered).toHaveLength(0)
    })

    it('should handle recently completed tasks with deleted list references', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      // Recently completed task (within 24 hours)
      const recentlyCompletedTask = createMockTask({
        completed: true,
        updatedAt: new Date(), // Just now
        lists: [
          null as any, // Deleted list
          { id: 'list-1', name: 'Active List', color: '#4f46e5' }
        ]
      })

      const tasks = [recentlyCompletedTask]

      act(() => {
        result.current.setCompleted('default')
      })

      const filtered = result.current.applyFiltersToTasks(tasks, mockUserId, mockLists)

      // Recently completed task should still show (within 24 hour window)
      expect(filtered).toHaveLength(1)
      expect(filtered[0].completed).toBe(true)
    })

    it('should handle universal search with deleted list references', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      const taskWithDeletedList = createMockTask({
        creatorId: mockUserId,
        lists: [
          null as any,
          { id: 'list-1', name: 'Active List', color: '#4f46e5' }
        ]
      })

      const tasks = [taskWithDeletedList]

      act(() => {
        result.current.setSearch('Test')
      })

      // Universal search should handle null list references gracefully
      expect(() => {
        result.current.applyFiltersToTasks(tasks, mockUserId, mockLists)
      }).not.toThrow()
    })

    it('should filter public tasks with deleted list references', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'public'
      }))

      const publicList: any = {
        id: 'public-list',
        name: 'Public List',
        privacy: 'PUBLIC',
        color: '#10b981'
      }

      const taskWithPublicAndDeletedLists = createMockTask({
        lists: [
          null as any, // Deleted list
          publicList
        ]
      })

      const tasks = [taskWithPublicAndDeletedLists]
      const filtered = result.current.applyFiltersToTasks(tasks, mockUserId, [
        ...mockLists,
        { ...mockLists[0], id: 'public-list', privacy: 'PUBLIC' } as TaskList
      ])

      // Should find the public task despite deleted list references
      expect(filtered).toHaveLength(1)
    })
  })

  describe('Edge cases with empty and undefined lists', () => {
    it('should handle tasks with undefined lists property', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      const taskWithUndefinedLists = createMockTask({
        lists: undefined as any
      })

      const tasks = [taskWithUndefinedLists]

      expect(() => {
        result.current.applyFiltersToTasks(tasks, mockUserId, mockLists)
      }).not.toThrow()
    })

    it('should handle tasks with empty lists array', () => {
      const { result } = renderHook(() => useFilterState({
        selectedListId: 'list-1'
      }))

      const taskWithEmptyLists = createMockTask({
        lists: []
      })

      const tasks = [taskWithEmptyLists]
      const filtered = result.current.applyFiltersToTasks(tasks, mockUserId, mockLists)

      // Task with no lists should be filtered out
      expect(filtered).toHaveLength(0)
    })
  })
})
