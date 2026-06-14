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

describe('copyListWithTasks — project membership access (task 2e2e2300)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads the project relation so project members can copy a private project list', async () => {
    // A PRIVATE list with NO direct list members, but inside a project the
    // copying user belongs to. Access must come from project membership.
    const projectMemberId = 'project-member-id'
    const originalList = {
      id: 'list-in-project',
      name: 'Project List',
      description: 'desc',
      color: '#fff',
      privacy: 'PRIVATE',
      ownerId: 'owner-id',
      owner: { id: 'owner-id', name: 'Owner', email: 'owner@example.com', image: null },
      listMembers: [],
      project: {
        ownerId: 'owner-id',
        owner: { id: 'owner-id', name: 'Owner', email: 'owner@example.com', image: null },
        members: [
          {
            userId: projectMemberId,
            role: 'member',
            user: { id: projectMemberId, name: 'Member', email: 'member@example.com', image: null },
          },
        ],
      },
      tasks: [],
    }

    const createdList = { id: 'copied-list-id', name: 'Copy of Project List' }

    mockPrisma.taskList.updateMany.mockResolvedValue({ count: 0 })
    // First findUnique → original list (with project); second → final hydrated list.
    mockPrisma.taskList.findUnique
      .mockResolvedValueOnce(originalList)
      .mockResolvedValueOnce({ ...createdList, owner: originalList.owner, tasks: [], listMembers: [] })
    mockPrisma.taskList.create.mockResolvedValue(createdList)
    mockPrisma.taskList.update.mockResolvedValue(createdList)

    const result = await copyListWithTasks('list-in-project', {
      newOwnerId: projectMemberId,
      includeTasks: false,
    })

    // The fix: the original-list query must request the project relation,
    // otherwise canAccessList only sees list members and denies project members.
    const firstFindArgs = mockPrisma.taskList.findUnique.mock.calls[0][0]
    expect(firstFindArgs.include?.project).toBeDefined()

    // Behavioral: a project member is granted copy access.
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
  })
})
