import { describe, it, expect, beforeEach, vi } from 'vitest'
import { copyTask, copyListWithTasks } from '@/lib/copy-utils'
import { mockPrisma } from '../setup'

describe('copyTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('assignee behavior', () => {
    it('should make task unassigned when copying to a list', async () => {
      const originalTask = {
        id: 'original-task-id',
        title: 'Test Task',
        description: 'Test Description',
        priority: 2,
        completed: false,
        repeating: 'never',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 5,
        isPrivate: false,
        assigneeId: 'original-assignee-id', // Has an assignee
        creatorId: 'original-creator-id',
        originalTaskId: null,
        dueDateTime: new Date('2025-12-25'),
        createdAt: new Date(),
        updatedAt: new Date(),
        comments: [],
        attachments: [],
        lists: []
      }

      const copiedTask = {
        id: 'copied-task-id',
        title: 'Test Task',
        description: 'Test Description',
        priority: 2,
        completed: false,
        repeating: 'never',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 0,
        isPrivate: false,
        assigneeId: null, // Should be unassigned
        creatorId: 'new-owner-id',
        originalTaskId: 'original-task-id',
        dueDateTime: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignee: null,
        creator: { id: 'new-owner-id', name: 'New Owner', email: 'new@example.com' },
        lists: [{ id: 'target-list-id', name: 'Target List' }]
      }

      mockPrisma.task.findUnique.mockResolvedValue(originalTask)
      mockPrisma.task.create.mockResolvedValue(copiedTask)

      const result = await copyTask('original-task-id', {
        newOwnerId: 'new-owner-id',
        targetListId: 'target-list-id',
        preserveDueDate: false,
        preserveAssignee: false
      })

      expect(result.success).toBe(true)
      expect(result.copiedTask?.assigneeId).toBeNull()

      // Verify the task was created with assigneeId: null
      expect(mockPrisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          assigneeId: null,
          creatorId: 'new-owner-id',
          lists: {
            connect: [{ id: 'target-list-id' }]
          }
        }),
        include: expect.any(Object)
      })
    })

    it('should assign task to current user when copying without a list (My Tasks only)', async () => {
      const originalTask = {
        id: 'original-task-id',
        title: 'Test Task',
        description: 'Test Description',
        priority: 2,
        completed: false,
        repeating: 'never',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 5,
        isPrivate: false,
        assigneeId: 'original-assignee-id', // Has an assignee
        creatorId: 'original-creator-id',
        originalTaskId: null,
        dueDateTime: new Date('2025-12-25'),
        createdAt: new Date(),
        updatedAt: new Date(),
        comments: [],
        attachments: [],
        lists: []
      }

      const copiedTask = {
        id: 'copied-task-id',
        title: 'Test Task',
        description: 'Test Description',
        priority: 2,
        completed: false,
        repeating: 'never',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 0,
        isPrivate: false,
        assigneeId: 'new-owner-id', // Should be assigned to new owner
        creatorId: 'new-owner-id',
        originalTaskId: 'original-task-id',
        dueDateTime: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignee: { id: 'new-owner-id', name: 'New Owner', email: 'new@example.com' },
        creator: { id: 'new-owner-id', name: 'New Owner', email: 'new@example.com' },
        lists: []
      }

      mockPrisma.task.findUnique.mockResolvedValue(originalTask)
      mockPrisma.task.create.mockResolvedValue(copiedTask)

      const result = await copyTask('original-task-id', {
        newOwnerId: 'new-owner-id',
        // No targetListId - copying to My Tasks only
        preserveDueDate: false,
        preserveAssignee: false
      })

      expect(result.success).toBe(true)
      expect(result.copiedTask?.assigneeId).toBe('new-owner-id')

      // Verify the task was created with assigneeId: new-owner-id
      expect(mockPrisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          assigneeId: 'new-owner-id',
          creatorId: 'new-owner-id'
        }),
        include: expect.any(Object)
      })
    })

    it('should make task unassigned when copying to a list even if original task was unassigned', async () => {
      const originalTask = {
        id: 'original-task-id',
        title: 'Test Task',
        description: 'Test Description',
        priority: 2,
        completed: false,
        repeating: 'never',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 0,
        isPrivate: false,
        assigneeId: null, // Already unassigned
        creatorId: 'original-creator-id',
        originalTaskId: null,
        dueDateTime: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        comments: [],
        attachments: [],
        lists: []
      }

      const copiedTask = {
        id: 'copied-task-id',
        title: 'Test Task',
        description: 'Test Description',
        priority: 2,
        completed: false,
        repeating: 'never',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 0,
        isPrivate: false,
        assigneeId: null,
        creatorId: 'new-owner-id',
        originalTaskId: 'original-task-id',
        dueDateTime: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignee: null,
        creator: { id: 'new-owner-id', name: 'New Owner', email: 'new@example.com' },
        lists: [{ id: 'target-list-id', name: 'Target List' }]
      }

      mockPrisma.task.findUnique.mockResolvedValue(originalTask)
      mockPrisma.task.create.mockResolvedValue(copiedTask)

      const result = await copyTask('original-task-id', {
        newOwnerId: 'new-owner-id',
        targetListId: 'target-list-id'
      })

      expect(result.success).toBe(true)
      expect(result.copiedTask?.assigneeId).toBeNull()
    })

    it('should assign to current user when copying without a list even if original task was unassigned', async () => {
      const originalTask = {
        id: 'original-task-id',
        title: 'Test Task',
        description: 'Test Description',
        priority: 2,
        completed: false,
        repeating: 'never',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 0,
        isPrivate: false,
        assigneeId: null, // Already unassigned
        creatorId: 'original-creator-id',
        originalTaskId: null,
        dueDateTime: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        comments: [],
        attachments: [],
        lists: []
      }

      const copiedTask = {
        id: 'copied-task-id',
        title: 'Test Task',
        description: 'Test Description',
        priority: 2,
        completed: false,
        repeating: 'never',
        repeatingData: null,
        repeatFrom: 'COMPLETION_DATE',
        occurrenceCount: 0,
        isPrivate: false,
        assigneeId: 'new-owner-id',
        creatorId: 'new-owner-id',
        originalTaskId: 'original-task-id',
        dueDateTime: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        assignee: { id: 'new-owner-id', name: 'New Owner', email: 'new@example.com' },
        creator: { id: 'new-owner-id', name: 'New Owner', email: 'new@example.com' },
        lists: []
      }

      mockPrisma.task.findUnique.mockResolvedValue(originalTask)
      mockPrisma.task.create.mockResolvedValue(copiedTask)

      const result = await copyTask('original-task-id', {
        newOwnerId: 'new-owner-id'
        // No targetListId
      })

      expect(result.success).toBe(true)
      expect(result.copiedTask?.assigneeId).toBe('new-owner-id')
    })
  })
})
