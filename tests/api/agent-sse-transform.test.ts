/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock prisma before importing the module under test
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
    },
  },
}))

// Mock auth dependencies that agent-protocol imports
vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  UnauthorizedError: class extends Error {},
  ForbiddenError: class extends Error {},
}))

vi.mock('@/lib/oauth/oauth-scopes', () => ({
  hasRequiredScopes: vi.fn().mockReturnValue(true),
}))

import { prisma } from '@/lib/prisma'
import { mapEventType, transformEventForAgent } from '@/lib/agent-protocol'

describe('Agent SSE Event Transform', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('mapEventType', () => {
    it('should map task_assigned to task.assigned', () => {
      expect(mapEventType('task_assigned')).toBe('task.assigned')
    })

    it('should map task_created to task.assigned', () => {
      expect(mapEventType('task_created')).toBe('task.assigned')
    })

    it('should map task_updated to task.updated', () => {
      expect(mapEventType('task_updated')).toBe('task.updated')
    })

    it('should map task_completed to task.completed', () => {
      expect(mapEventType('task_completed')).toBe('task.completed')
    })

    it('should map task_deleted to task.deleted', () => {
      expect(mapEventType('task_deleted')).toBe('task.deleted')
    })

    it('should map comment_created to task.commented', () => {
      expect(mapEventType('comment_created')).toBe('task.commented')
    })

    it('should map comment_added to task.commented', () => {
      expect(mapEventType('comment_added')).toBe('task.commented')
    })

    it('should return null for unknown types', () => {
      expect(mapEventType('unknown_event')).toBeNull()
      expect(mapEventType('ping')).toBeNull()
      expect(mapEventType('')).toBeNull()
    })
  })

  describe('transformEventForAgent', () => {
    it('should return null for unknown event types', async () => {
      const result = await transformEventForAgent({
        type: 'unknown_event',
        data: { taskId: 'task-1' },
      })
      expect(result).toBeNull()
    })

    it('should transform task_assigned events with full DB task', async () => {
      const dbTask = {
        id: 'task-123',
        title: 'Fix the bug',
        description: 'Detailed description',
        priority: 2,
        completed: false,
        dueDateTime: new Date('2026-03-01'),
        isAllDay: false,
        createdAt: new Date('2026-02-20'),
        updatedAt: new Date('2026-02-21'),
        lists: [{ id: 'list-1', name: 'Dev Tasks', description: 'Agent instructions here', color: '#ff0000' }],
        assignee: { id: 'agent-1', name: 'AI Agent', email: 'agent@test.com', isAIAgent: true },
        creator: { id: 'user-1', name: 'Alice', email: 'alice@test.com' },
        comments: [
          {
            id: 'comment-1',
            content: 'Please fix this ASAP',
            createdAt: new Date('2026-02-20'),
            author: { id: 'user-1', name: 'Alice', email: 'alice@test.com', isAIAgent: false },
            authorId: 'user-1',
          },
        ],
      }

      vi.mocked(prisma.task.findUnique).mockResolvedValue(dbTask as any)

      const result = await transformEventForAgent({
        type: 'task_assigned',
        timestamp: '2026-02-21T00:00:00Z',
        data: { taskId: 'task-123', title: 'Fix the bug' },
      })

      expect(result).not.toBeNull()
      expect(result!.type).toBe('task.assigned')
      expect(result!.data.taskId).toBe('task-123')

      // Verify full AgentTask structure
      const task = result!.data.task
      expect(task.id).toBe('task-123')
      expect(task.title).toBe('Fix the bug')
      expect(task.description).toBe('Detailed description')
      expect(task.priority).toBe(2)
      expect(task.listId).toBe('list-1')
      expect(task.listName).toBe('Dev Tasks')
      expect(task.listDescription).toBe('Agent instructions here')
      expect(task.assignerName).toBe('Alice')
      expect(task.assignerId).toBe('user-1')
      expect(task.comments).toHaveLength(1)
      expect(task.comments[0].authorName).toBe('Alice')
      expect(task.comments[0].isAgent).toBe(false)

      // Verify prisma was called with correct include
      expect(prisma.task.findUnique).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        include: expect.objectContaining({
          lists: expect.any(Object),
          assignee: expect.any(Object),
          creator: expect.any(Object),
          comments: expect.any(Object),
        }),
      })
    })

    it('should transform task_created events the same as task_assigned', async () => {
      const dbTask = {
        id: 'task-456',
        title: 'New task',
        description: '',
        priority: 0,
        completed: false,
        dueDateTime: null,
        isAllDay: false,
        createdAt: new Date('2026-02-21'),
        updatedAt: new Date('2026-02-21'),
        lists: [],
        assignee: null,
        creator: { id: 'user-1', name: 'Bob', email: 'bob@test.com' },
        comments: [],
      }

      vi.mocked(prisma.task.findUnique).mockResolvedValue(dbTask as any)

      const result = await transformEventForAgent({
        type: 'task_created',
        data: { taskId: 'task-456' },
      })

      expect(result!.type).toBe('task.assigned')
      expect(result!.data.taskId).toBe('task-456')
      expect(result!.data.task.title).toBe('New task')
    })

    it('should return null for task_assigned if taskId is missing', async () => {
      const result = await transformEventForAgent({
        type: 'task_assigned',
        data: {},
      })
      expect(result).toBeNull()
    })

    it('should return null for task_assigned if task not found in DB', async () => {
      vi.mocked(prisma.task.findUnique).mockResolvedValue(null)

      const result = await transformEventForAgent({
        type: 'task_assigned',
        data: { taskId: 'nonexistent' },
      })
      expect(result).toBeNull()
    })

    it('should transform comment_created events to AgentComment format', async () => {
      const result = await transformEventForAgent({
        type: 'comment_created',
        data: {
          taskId: 'task-789',
          comment: {
            id: 'comment-1',
            content: 'Great work on this!',
            authorId: 'user-1',
            author: {
              id: 'user-1',
              name: 'Alice',
              email: 'alice@test.com',
              isAIAgent: false,
            },
            createdAt: '2026-02-21T10:00:00Z',
          },
        },
      })

      expect(result).not.toBeNull()
      expect(result!.type).toBe('task.commented')
      expect(result!.data.taskId).toBe('task-789')

      const comment = result!.data.comment
      expect(comment.id).toBe('comment-1')
      expect(comment.content).toBe('Great work on this!')
      expect(comment.authorName).toBe('Alice')
      expect(comment.authorId).toBe('user-1')
      expect(comment.isAgent).toBe(false)
      expect(comment.createdAt).toBe('2026-02-21T10:00:00Z')
    })

    it('should transform comment_added the same as comment_created', async () => {
      const result = await transformEventForAgent({
        type: 'comment_added',
        data: {
          taskId: 'task-789',
          comment: {
            id: 'comment-2',
            content: 'Agent response',
            authorId: 'agent-1',
            author: {
              id: 'agent-1',
              name: 'AI Agent',
              email: 'agent@test.com',
              isAIAgent: true,
            },
            createdAt: '2026-02-21T11:00:00Z',
          },
        },
      })

      expect(result!.type).toBe('task.commented')
      expect(result!.data.comment.isAgent).toBe(true)
      expect(result!.data.comment.authorName).toBe('AI Agent')
    })

    it('should use email as fallback for authorName', async () => {
      const result = await transformEventForAgent({
        type: 'comment_created',
        data: {
          taskId: 'task-789',
          comment: {
            id: 'comment-3',
            content: 'Hello',
            authorId: 'user-2',
            author: {
              id: 'user-2',
              name: null,
              email: 'noname@test.com',
              isAIAgent: false,
            },
            createdAt: '2026-02-21T12:00:00Z',
          },
        },
      })

      expect(result!.data.comment.authorName).toBe('noname@test.com')
    })

    it('should handle comment_created with null comment gracefully', async () => {
      const result = await transformEventForAgent({
        type: 'comment_created',
        data: {
          taskId: 'task-789',
          comment: null,
        },
      })

      expect(result).not.toBeNull()
      expect(result!.type).toBe('task.commented')
      expect(result!.data.comment).toBeNull()
    })

    it('should pass through task_updated events', async () => {
      const result = await transformEventForAgent({
        type: 'task_updated',
        data: {
          taskId: 'task-100',
          title: 'Updated title',
          priority: 3,
        },
      })

      expect(result!.type).toBe('task.updated')
      expect(result!.data.taskId).toBe('task-100')
      expect(result!.data.title).toBe('Updated title')
      expect(result!.data.priority).toBe(3)
    })

    it('should pass through task_completed events', async () => {
      const result = await transformEventForAgent({
        type: 'task_completed',
        data: { taskId: 'task-200' },
      })

      expect(result!.type).toBe('task.completed')
      expect(result!.data.taskId).toBe('task-200')
    })

    it('should pass through task_deleted events', async () => {
      const result = await transformEventForAgent({
        type: 'task_deleted',
        data: { taskId: 'task-300' },
      })

      expect(result!.type).toBe('task.deleted')
      expect(result!.data.taskId).toBe('task-300')
    })

    it('should handle missing data gracefully', async () => {
      const result = await transformEventForAgent({
        type: 'task_completed',
      })

      expect(result!.type).toBe('task.completed')
      expect(result!.data.taskId).toBeUndefined()
    })

    it('should not call prisma for non-task events', async () => {
      await transformEventForAgent({
        type: 'comment_created',
        data: {
          taskId: 'task-1',
          comment: { id: 'c1', content: 'test', authorId: 'u1', author: { id: 'u1', name: 'A', isAIAgent: false }, createdAt: '2026-01-01' },
        },
      })

      expect(prisma.task.findUnique).not.toHaveBeenCalled()
    })
  })
})
