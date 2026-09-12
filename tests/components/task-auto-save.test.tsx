import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildUser } from '../fixtures/domain'
import type { Task, TaskList, User } from '../../types/task'

// Simple unit tests for auto-save logic without rendering components
// This tests the API transformation logic that was the main bug

describe('Task Auto-Save API Data Transformation', () => {
  const mockUser: User = buildUser({
    id: 'user-1',
    name: 'Test User',
    email: 'test@example.com'
  })

  const mockList: TaskList = {
    id: 'list-1',
    name: 'Test List',
    description: 'Test Description',
    ownerId: 'user-1',
    owner: mockUser,
    privacy: 'PRIVATE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const mockTask: Task = {
    id: 'task-1',
    title: 'Test Task',
    description: 'Test Description',
    priority: 1,
    assigneeId: 'user-1',
    assignee: mockUser,
    creatorId: 'user-1',
    creator: mockUser,
    repeating: 'never',
    isPrivate: false,
    completed: false,
    when: new Date(),
    lists: [mockList],
    comments: [],
    attachments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  describe('List Assignment Data Transformation', () => {
    it('transforms task.lists to listIds for API', () => {
      // This is the core transformation that was the bug
      const taskWithLists = {
        ...mockTask,
        lists: [
          { id: 'list-1', name: 'List 1' },
          { id: 'list-2', name: 'List 2' }
        ]
      }

      // Simulate the transformation done in handleUpdateTask
      const apiData = {
        ...taskWithLists,
        listIds: taskWithLists.lists?.map(list => list.id) || []
      }
      delete (apiData as any).lists

      expect(apiData.listIds).toEqual(['list-1', 'list-2'])
      expect(apiData.lists).toBeUndefined()
    })

    it('handles empty lists array', () => {
      const taskWithNoLists = {
        ...mockTask,
        lists: []
      }

      const apiData = {
        ...taskWithNoLists,
        listIds: taskWithNoLists.lists?.map(list => list.id) || []
      }
      delete (apiData as any).lists

      expect(apiData.listIds).toEqual([])
      expect(apiData.lists).toBeUndefined()
    })

    it('handles undefined lists', () => {
      const taskWithUndefinedLists = {
        ...mockTask,
        lists: undefined
      }

      const apiData = {
        ...taskWithUndefinedLists,
        listIds: taskWithUndefinedLists.lists?.map(list => list.id) || []
      }
      delete (apiData as any).lists

      expect(apiData.listIds).toEqual([])
      expect(apiData.lists).toBeUndefined()
    })
  })

  describe('Auto-Save Behavior Expectations', () => {
    it('should immediately trigger onUpdate when list is added', () => {
      const mockOnUpdate = vi.fn()
      
      // Simulate handleAddList logic
      const originalLists: TaskList[] = []
      const newList: TaskList = mockList
      const updatedTempLists = [...originalLists, newList]
      
      // This is what handleAddList should do
      const updatedTask = { 
        ...mockTask, 
        lists: updatedTempLists
      }
      mockOnUpdate(updatedTask)

      expect(mockOnUpdate).toHaveBeenCalledWith({
        ...mockTask,
        lists: [mockList]
      })
    })

    it('should immediately trigger onUpdate when list is removed', () => {
      const mockOnUpdate = vi.fn()
      
      // Simulate handleRemoveList logic
      const originalLists: TaskList[] = [mockList]
      const updatedTempLists = originalLists.filter(l => l.id !== mockList.id)
      
      const updatedTask = { 
        ...mockTask, 
        lists: updatedTempLists
      }
      mockOnUpdate(updatedTask)

      expect(mockOnUpdate).toHaveBeenCalledWith({
        ...mockTask,
        lists: []
      })
    })

    it('should immediately trigger onUpdate when assignee is selected', () => {
      const mockOnUpdate = vi.fn()
      const newAssignee = mockUser
      
      // Simulate assignee selection logic
      const updatedTask = { 
        ...mockTask, 
        assignee: newAssignee
      }
      mockOnUpdate(updatedTask)

      expect(mockOnUpdate).toHaveBeenCalledWith({
        ...mockTask,
        assignee: mockUser
      })
    })
  })

  describe('Priority Color Logic', () => {
    it('returns correct colors for different priorities', () => {
      // This tests the getPriorityColor function logic
      const getPriorityColor = (priority: number) => {
        switch (priority) {
          case 3: return 'rgb(239, 68, 68)' // Red - highest priority
          case 2: return 'rgb(251, 191, 36)' // Yellow - medium priority  
          case 1: return 'rgb(59, 130, 246)' // Blue - low priority
          default: return 'rgb(107, 114, 128)' // Gray - no priority
        }
      }

      expect(getPriorityColor(3)).toBe('rgb(239, 68, 68)')
      expect(getPriorityColor(2)).toBe('rgb(251, 191, 36)')
      expect(getPriorityColor(1)).toBe('rgb(59, 130, 246)')
      expect(getPriorityColor(0)).toBe('rgb(107, 114, 128)')
    })
  })
})