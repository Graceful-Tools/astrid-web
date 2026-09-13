import { describe, it, expect, beforeEach } from 'vitest'
import { applyVirtualListFilter } from '@/lib/virtual-list-utils'
import { Task, TaskList } from '@/types/task'

describe('My Tasks Filtering', () => {
  const currentUserId = 'user-123'
  const otherUserId = 'user-456'

  let myTasksList: TaskList
  let mockTasks: Task[]

  beforeEach(() => {
    // Create a My Tasks virtual list
    myTasksList = {
      id: 'my-tasks',
      name: 'My Tasks',
      description: 'Tasks assigned to you',
      color: '#3b82f6',
      privacy: 'PRIVATE',
      createdAt: new Date(),
      updatedAt: new Date(),
      ownerId: currentUserId,
      defaultPriority: 0,
      defaultRepeating: 'never',
      defaultIsPrivate: true,
      defaultDueDate: 'none',
      isFavorite: false,
      isVirtual: true,
      virtualListType: 'my-tasks',
      owner: { id: currentUserId, name: '', email: '', createdAt: new Date() },
      tasks: [],
      admins: [],
      members: [],
      listMembers: []
    }

    // Create mock tasks with different assignee scenarios
    mockTasks = [
      {
        id: 'task-1',
        title: 'Task assigned to current user',
        description: '',
        priority: 1,
        completed: false,
        assigneeId: currentUserId, // Assigned to current user
        creatorId: currentUserId,
        dueDateTime: null,
        isPrivate: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lists: []
      },
      {
        id: 'task-2',
        title: 'Task assigned to another user',
        description: '',
        priority: 1,
        completed: false,
        assigneeId: otherUserId, // Assigned to different user
        creatorId: currentUserId,
        dueDateTime: null,
        isPrivate: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lists: []
      },
      {
        id: 'task-3',
        title: 'Unassigned task',
        description: '',
        priority: 1,
        completed: false,
        assigneeId: null, // No assignee (unassigned)
        creatorId: currentUserId,
        dueDateTime: null,
        isPrivate: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lists: []
      },
      {
        id: 'task-4',
        title: 'Another task assigned to current user',
        description: '',
        priority: 2,
        completed: true,
        assigneeId: currentUserId, // Assigned to current user
        creatorId: otherUserId,
        dueDateTime: null,
        isPrivate: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lists: []
      }
    ]
  })

  describe('Default My Tasks filtering (no explicit filters)', () => {
    it('should only include tasks assigned to current user', () => {
      const filtered = applyVirtualListFilter(mockTasks, myTasksList, currentUserId)

      expect(filtered).toHaveLength(2)
      expect(filtered.map(t => t.id)).toEqual(['task-1', 'task-4'])

      // Verify all returned tasks are assigned to current user
      filtered.forEach(task => {
        expect(task.assigneeId).toBe(currentUserId)
      })
    })

    it('should exclude unassigned tasks', () => {
      const filtered = applyVirtualListFilter(mockTasks, myTasksList, currentUserId)

      // Should not include task-3 (unassigned)
      expect(filtered.find(t => t.id === 'task-3')).toBeUndefined()

      // Should not include any tasks with null assigneeId
      filtered.forEach(task => {
        expect(task.assigneeId).not.toBeNull()
      })
    })

    it('should exclude tasks assigned to other users', () => {
      const filtered = applyVirtualListFilter(mockTasks, myTasksList, currentUserId)

      // Should not include task-2 (assigned to different user)
      expect(filtered.find(t => t.id === 'task-2')).toBeUndefined()

      // Should not include any tasks assigned to other users
      filtered.forEach(task => {
        expect(task.assigneeId).not.toBe(otherUserId)
      })
    })
  })

  describe('My Tasks with explicit assignee filter override', () => {
    it('should respect filterAssignee="unassigned" when explicitly set', () => {
      const myTasksListWithFilter = {
        ...myTasksList,
        filterAssignee: 'unassigned' as const
      }

      const filtered = applyVirtualListFilter(mockTasks, myTasksListWithFilter, currentUserId)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('task-3')
      expect(filtered[0].assigneeId).toBeNull()
    })

    it('should respect filterAssignee="all" when explicitly set', () => {
      const myTasksListWithFilter = {
        ...myTasksList,
        filterAssignee: 'all' as const
      }

      const filtered = applyVirtualListFilter(mockTasks, myTasksListWithFilter, currentUserId)

      // Should still only show tasks assigned to current user (the base "my-tasks" logic)
      expect(filtered).toHaveLength(2)
      expect(filtered.map(t => t.id)).toEqual(['task-1', 'task-4'])
    })

    it('should respect filterAssignee="not_current_user" when explicitly set', () => {
      const myTasksListWithFilter = {
        ...myTasksList,
        filterAssignee: 'not_current_user' as const
      }

      const filtered = applyVirtualListFilter(mockTasks, myTasksListWithFilter, currentUserId)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('task-2')
      expect(filtered[0].assigneeId).toBe(otherUserId)
    })
  })

  describe('My Tasks with other filters', () => {
    it('should apply completion filter while maintaining assignee logic', () => {
      const myTasksListWithFilter = {
        ...myTasksList,
        filterCompletion: 'completed' as const
      }

      const filtered = applyVirtualListFilter(mockTasks, myTasksListWithFilter, currentUserId)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('task-4')
      expect(filtered[0].assigneeId).toBe(currentUserId)
      expect(filtered[0].completed).toBe(true)
    })

    it('should apply priority filter while maintaining assignee logic', () => {
      const myTasksListWithFilter = {
        ...myTasksList,
        filterPriority: '2'
      }

      const filtered = applyVirtualListFilter(mockTasks, myTasksListWithFilter, currentUserId)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].id).toBe('task-4')
      expect(filtered[0].assigneeId).toBe(currentUserId)
      expect(filtered[0].priority).toBe(2)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty task list', () => {
      const filtered = applyVirtualListFilter([], myTasksList, currentUserId)
      expect(filtered).toHaveLength(0)
    })

    it('should handle tasks with undefined assigneeId', () => {
      const tasksWithUndefined = [
        {
          ...mockTasks[0],
          assigneeId: undefined as any
        }
      ]

      const filtered = applyVirtualListFilter(tasksWithUndefined, myTasksList, currentUserId)
      expect(filtered).toHaveLength(0)
    })

    it('should work when user has no assigned tasks', () => {
      const tasksForOtherUsers = mockTasks.map(task => ({
        ...task,
        assigneeId: otherUserId
      }))

      const filtered = applyVirtualListFilter(tasksForOtherUsers, myTasksList, currentUserId)
      expect(filtered).toHaveLength(0)
    })
  })
})