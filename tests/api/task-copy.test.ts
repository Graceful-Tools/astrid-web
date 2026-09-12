import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/tasks/[id]/copy/route'
import { mockPrisma, mockGetServerSession } from '../setup'

// Mock NextRequest
const createMockRequest = (data?: unknown) => {
  const request = new NextRequest('http://localhost:3000/api/tasks/test-task-id/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data ?? {}),
  })
  return request
}

// Mock RouteContextParams
const createMockContext = (id: string) => ({
  params: Promise.resolve({ id })
})

describe('Task Copy API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mock user exists in database
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: 'test-image-url',
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: null
    })

    // Mock list access validation - user has access to target list
    mockPrisma.taskList.findFirst.mockResolvedValue({
      id: 'target-list-id',
      name: 'Target List',
      ownerId: 'test-user-id',
      privacy: 'PRIVATE'
    })
  })

  describe('POST /api/tasks/[id]/copy', () => {
    it('should copy task with complete relations', async () => {
      const originalTask = {
        id: 'original-task-id',
        title: 'Original Task',
        description: 'Original Description',
        priority: 2,
        completed: false,
        repeating: 'never',
        repeatingData: null,
        isPrivate: false,
        assigneeId: 'other-user-id',
        creatorId: 'other-user-id',
        originalTaskId: null,
        dueDateTime: new Date('2025-12-25'),
        createdAt: new Date(),
        updatedAt: new Date(),
        comments: [],
        attachments: [],
        lists: [{ id: 'target-list-id', name: 'Target List' }]
      }

      const copiedTask = {
        id: 'copied-task-id',
        title: 'Original Task [copy]',
        description: 'Original Description',
        priority: 2,
        completed: false,
        repeating: 'never',
        repeatingData: null,
        isPrivate: false,
        assigneeId: 'test-user-id',
        creatorId: 'test-user-id',
        originalTaskId: 'original-task-id',
        dueDateTime: new Date('2025-12-25'),
        createdAt: new Date(),
        updatedAt: new Date()
      }

      const copiedTaskWithRelations = {
        ...copiedTask,
        assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        lists: [{ id: 'target-list-id', name: 'Target List' }],
        comments: [],
        attachments: []
      }

      // Mock the copyTask utility flow
      mockPrisma.task.findUnique
        .mockResolvedValueOnce(originalTask) // First call: copyTask utility fetches original
        .mockResolvedValueOnce({ creatorId: 'other-user-id' }) // Second call: stats invalidation fetches creator
        .mockResolvedValueOnce(copiedTaskWithRelations) // Third call: API fetches with relations

      mockPrisma.task.create.mockResolvedValue(copiedTask)

      const requestData = {
        targetListId: 'target-list-id',
        preserveDueDate: true,
        preserveAssignee: false,
        includeComments: false
      }

      const request = createMockRequest(requestData)
      const context = createMockContext('original-task-id')
      const response = await POST(request, context)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.task).toBeDefined()

      // Verify complete task data with relations is returned
      expect(data.task.id).toBe('copied-task-id')
      expect(data.task.title).toBe('Original Task [copy]')
      expect(data.task.lists).toHaveLength(1)
      expect(data.task.lists[0].id).toBe('target-list-id')
      expect(data.task.assignee).toBeDefined()
      expect(data.task.creator).toBeDefined()
      expect(data.task.originalTaskId).toBe('original-task-id')
    })

    it('should return 401 for unauthenticated user', async () => {
      mockGetServerSession.mockResolvedValueOnce(null)

      const request = createMockRequest({})
      const context = createMockContext('original-task-id')
      const response = await POST(request, context)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Authentication required')
    })

    it('should return 403 when user does not have access to target list', async () => {
      // Override the default mock to return null (no access)
      mockPrisma.taskList.findFirst.mockResolvedValueOnce(null)

      const requestData = {
        targetListId: 'unauthorized-list-id',
        preserveDueDate: false
      }

      const request = createMockRequest(requestData)
      const context = createMockContext('original-task-id')
      const response = await POST(request, context)
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toContain("don't have permission")
    })

    it('should preserve due date when preserveDueDate is true', async () => {
      const dueDate = new Date('2025-12-31')
      const originalTask = {
        id: 'original-task-id',
        title: 'Task with due date',
        dueDateTime: dueDate,
        assigneeId: null,
        creatorId: 'other-user-id',
        comments: [],
        attachments: [],
        lists: [{ id: 'target-list-id' }]
      }

      const copiedTask = {
        id: 'copied-task-id',
        title: 'Task with due date [copy]',
        dueDateTime: dueDate,
        creatorId: 'test-user-id',
        originalTaskId: 'original-task-id'
      }

      const copiedTaskWithRelations = {
        ...copiedTask,
        creator: { id: 'test-user-id', name: 'Test User' },
        lists: [{ id: 'target-list-id' }],
        comments: [],
        attachments: []
      }

      mockPrisma.task.findUnique
        .mockResolvedValueOnce(originalTask) // First call: copyTask utility
        .mockResolvedValueOnce({ creatorId: 'other-user-id' }) // Second call: stats invalidation
        .mockResolvedValueOnce(copiedTaskWithRelations) // Third call: fetch with relations

      mockPrisma.task.create.mockResolvedValue(copiedTask)

      const requestData = {
        targetListId: 'target-list-id',
        preserveDueDate: true
      }

      const request = createMockRequest(requestData)
      const context = createMockContext('original-task-id')
      const response = await POST(request, context)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.task.dueDateTime).toEqual(dueDate.toISOString())
    })

    it('should assign to user by default (not preserve assignee)', async () => {
      const originalTask = {
        id: 'original-task-id',
        title: 'Assigned Task',
        assigneeId: 'other-user-id',
        creatorId: 'other-user-id',
        comments: [],
        attachments: [],
        lists: [{ id: 'target-list-id' }]
      }

      const copiedTask = {
        id: 'copied-task-id',
        title: 'Assigned Task [copy]',
        assigneeId: 'test-user-id', // Assigned to copying user
        creatorId: 'test-user-id',
        originalTaskId: 'original-task-id'
      }

      const copiedTaskWithRelations = {
        ...copiedTask,
        assignee: { id: 'test-user-id', name: 'Test User' },
        creator: { id: 'test-user-id', name: 'Test User' },
        lists: [{ id: 'target-list-id' }],
        comments: [],
        attachments: []
      }

      mockPrisma.task.findUnique
        .mockResolvedValueOnce(originalTask) // First call: copyTask utility
        .mockResolvedValueOnce({ creatorId: 'other-user-id' }) // Second call: stats invalidation
        .mockResolvedValueOnce(copiedTaskWithRelations) // Third call: fetch with relations

      mockPrisma.task.create.mockResolvedValue(copiedTask)

      const requestData = {
        targetListId: 'target-list-id',
        preserveAssignee: false // Default behavior
      }

      const request = createMockRequest(requestData)
      const context = createMockContext('original-task-id')
      const response = await POST(request, context)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.task.assigneeId).toBe('test-user-id')
      expect(data.task.assignee.id).toBe('test-user-id')
    })

    it('should not copy system comments (authorId: null)', async () => {
      const originalTask = {
        id: 'original-task-id',
        title: 'Task with comments',
        assigneeId: null,
        creatorId: 'other-user-id',
        comments: [
          { id: 'user-comment', content: 'User comment', authorId: 'user-1', createdAt: new Date() },
          { id: 'system-comment', content: 'System comment', authorId: null, createdAt: new Date() }
        ],
        attachments: [],
        lists: [{ id: 'target-list-id' }]
      }

      const copiedTask = {
        id: 'copied-task-id',
        title: 'Task with comments [copy]',
        creatorId: 'test-user-id',
        originalTaskId: 'original-task-id'
      }

      const copiedTaskWithRelations = {
        ...copiedTask,
        creator: { id: 'test-user-id', name: 'Test User' },
        lists: [{ id: 'target-list-id' }],
        comments: [
          { id: 'new-user-comment', content: 'User comment', authorId: 'user-1', createdAt: new Date() }
        ],
        attachments: []
      }

      mockPrisma.task.findUnique
        .mockResolvedValueOnce(originalTask) // First call: copyTask utility
        .mockResolvedValueOnce({ creatorId: 'other-user-id' }) // Second call: stats invalidation
        .mockResolvedValueOnce(copiedTaskWithRelations) // Third call: fetch with relations

      mockPrisma.task.create.mockResolvedValue(copiedTask)
      mockPrisma.comment.createMany.mockResolvedValue({ count: 1 })

      const requestData = {
        targetListId: 'target-list-id',
        includeComments: true
      }

      const request = createMockRequest(requestData)
      const context = createMockContext('original-task-id')
      const response = await POST(request, context)
      const data = await response.json()

      expect(response.status).toBe(200)
      
      // Verify createMany was called with only the user comment
      expect(mockPrisma.comment.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            content: 'User comment',
            authorId: 'user-1'
          })
        ]
      })
      
      // Verify it was NOT called with the system comment
      const createManyCalls = mockPrisma.comment.createMany.mock.calls
      const createdComments = createManyCalls[0][0].data
      expect(createdComments).toHaveLength(1)
      expect(createdComments.find((c: any) => c.content === 'System comment')).toBeUndefined()
    })
  })
})
