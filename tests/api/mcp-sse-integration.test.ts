import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/mcp/operations/route'
import { broadcastToUsers } from '@/lib/sse-utils'

// Mock the SSE utils
vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

// Mock the auth config
vi.mock('@/lib/auth-config', () => ({
  authConfig: {},
}))

// Mock next-auth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    mCPToken: {
      findFirst: vi.fn(),
    },
    taskList: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    comment: {
      create: vi.fn(),
    },
  },
}))

// Mock rate limiter
vi.mock('@/lib/rate-limiter', () => ({
  RATE_LIMITS: {
    MCP_OPERATIONS: {},
  },
  withRateLimitAsync: vi.fn(() => async () => ({
    allowed: true,
    headers: {},
  })),
}))

describe('MCP SSE Integration', () => {
  const mockMcpToken = {
    id: 'test-token-id',
    token: 'test-access-token',
    userId: 'test-user-id',
    listId: 'test-list-id',
    permissions: ['read', 'write'],
    isActive: true,
    expiresAt: null,
    user: {
      id: 'test-user-id',
      name: 'Test MCP User',
      email: 'test@example.com',
      isAIAgent: true,
      mcpEnabled: true,
    },
    list: {
      id: 'test-list-id',
      name: 'Test List',
      ownerId: 'test-user-id',
      listMembers: [],
    },
  }

  const mockTask = {
    id: 'test-task-id',
    title: 'Test Task',
    description: 'Test task description',
    priority: 1,
    completed: false,
    assigneeId: 'test-assignee-id',
    creatorId: 'test-user-id',
    dueDateTime: null,
    isPrivate: false,
    assignee: {
      id: 'test-assignee-id',
      name: 'Test Assignee',
      email: 'assignee@example.com',
    },
    creator: {
      id: 'test-user-id',
      name: 'Test Creator',
      email: 'creator@example.com',
    },
    lists: [
      {
        id: 'test-list-id',
        name: 'Test List',
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('create_task operation', () => {
    it('should broadcast task_created SSE event', async () => {
      // Import the mocked prisma
      const { prisma } = await import('@/lib/prisma')

      // Mock Prisma operations
      vi.mocked(prisma.mCPToken.findFirst).mockResolvedValue(mockMcpToken)
      vi.mocked(prisma.taskList.findMany).mockResolvedValue([mockMcpToken.list])
      vi.mocked(prisma.task.create).mockResolvedValue(mockTask)

      // Mock list member retrieval
      vi.mocked(prisma.taskList.findFirst).mockResolvedValue({
        ...mockMcpToken.list,
        owner: { id: 'list-owner-id' },
        listMembers: [
          {
            id: 'lm-1',
            listId: 'test-list-id',
            userId: 'admin-user-id',
            role: 'admin',
            user: { id: 'admin-user-id' }
          },
          {
            id: 'lm-2',
            listId: 'test-list-id',
            userId: 'member-user-id',
            role: 'member',
            user: { id: 'member-user-id' }
          }
        ],
      } as any)

      const request = new NextRequest('http://localhost:3000/api/mcp/operations', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'create_task',
          args: {
            accessToken: 'test-access-token',
            listId: 'test-list-id',
            task: {
              title: 'Test Task',
              description: 'Test task description',
              priority: 1,
            },
          },
        }),
      })

      await POST(request)

      // Verify broadcastToUsers was called with correct event
      expect(broadcastToUsers).toHaveBeenCalledWith(
        expect.arrayContaining(['list-owner-id', 'admin-user-id', 'member-user-id']),
        expect.objectContaining({
          type: 'task_created',
          timestamp: expect.any(String),
          data: expect.objectContaining({
            taskId: 'test-task-id',
            taskTitle: 'Test Task',
            taskPriority: 1,
            creatorName: 'Test MCP User',
            userId: 'test-user-id',
            listNames: ['Test List'],
            task: expect.objectContaining({
              id: 'test-task-id',
              title: 'Test Task',
              priority: 1,
            }),
          }),
        })
      )
    })
  })

  describe('update_task operation', () => {
    it('should broadcast task_updated SSE event', async () => {
      // Import the mocked prisma
      const { prisma } = await import('@/lib/prisma')

      // Mock Prisma operations
      vi.mocked(prisma.mCPToken.findFirst).mockResolvedValue(mockMcpToken)
      vi.mocked(prisma.task.findFirst).mockResolvedValue(mockTask)
      vi.mocked(prisma.task.update).mockResolvedValue(mockTask)

      // Mock list member retrieval
      vi.mocked(prisma.taskList.findFirst).mockResolvedValue({
        ...mockMcpToken.list,
        owner: { id: 'list-owner-id' },
        listMembers: [
          {
            id: 'lm-1',
            listId: 'test-list-id',
            userId: 'admin-user-id',
            role: 'admin',
            user: { id: 'admin-user-id' }
          },
          {
            id: 'lm-2',
            listId: 'test-list-id',
            userId: 'member-user-id',
            role: 'member',
            user: { id: 'member-user-id' }
          }
        ],
      } as any)

      const request = new NextRequest('http://localhost:3000/api/mcp/operations', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'update_task',
          args: {
            accessToken: 'test-access-token',
            taskUpdate: {
              taskId: 'test-task-id',
              title: 'Updated Task Title',
              completed: true,
            },
          },
        }),
      })

      await POST(request)

      // Verify broadcastToUsers was called with task_updated event
      expect(broadcastToUsers).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          type: 'task_updated',
          timestamp: expect.any(String),
          data: expect.objectContaining({
            taskId: 'test-task-id',
            taskTitle: 'Test Task',
            taskCompleted: false,
            updaterName: 'Test MCP User',
            userId: 'test-user-id',
          }),
        })
      )
    })
  })

  describe('add_comment operation', () => {
    it('should broadcast comment_created SSE event', async () => {
      const mockComment = {
        id: 'test-comment-id',
        content: 'Test comment content',
        type: 'TEXT',
        createdAt: new Date(),
        author: {
          id: 'test-user-id',
          name: 'Test MCP User',
          email: 'test@example.com',
        },
      }

      // Import the mocked prisma
      const { prisma } = await import('@/lib/prisma')

      // Mock Prisma operations
      vi.mocked(prisma.mCPToken.findFirst).mockResolvedValue(mockMcpToken)
      vi.mocked(prisma.task.findFirst).mockResolvedValue({
        ...mockTask,
        lists: [{ id: 'test-list-id', name: 'Test List' }],
      })
      vi.mocked(prisma.comment.create).mockResolvedValue(mockComment)

      // Mock list member retrieval
      vi.mocked(prisma.taskList.findFirst).mockResolvedValue({
        ...mockMcpToken.list,
        owner: { id: 'list-owner-id' },
        listMembers: [
          {
            id: 'lm-1',
            listId: 'test-list-id',
            userId: 'admin-user-id',
            role: 'admin',
            user: { id: 'admin-user-id' }
          },
          {
            id: 'lm-2',
            listId: 'test-list-id',
            userId: 'member-user-id',
            role: 'member',
            user: { id: 'member-user-id' }
          }
        ],
      } as any)

      const request = new NextRequest('http://localhost:3000/api/mcp/operations', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'add_comment',
          args: {
            accessToken: 'test-access-token',
            taskId: 'test-task-id',
            comment: {
              content: 'Test comment content',
              type: 'TEXT',
            },
          },
        }),
      })

      await POST(request)

      // Verify broadcastToUsers was called with comment_created event
      expect(broadcastToUsers).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          type: 'comment_created',
          timestamp: expect.any(String),
          data: expect.objectContaining({
            taskId: 'test-task-id',
            commentId: 'test-comment-id',
            commentContent: 'Test comment content',
            commenterName: 'Test MCP User',
            userId: 'test-user-id',
          }),
        })
      )
    })
  })

  describe('delete_task operation', () => {
    it('should broadcast task_deleted SSE event', async () => {
      // Import the mocked prisma
      const { prisma } = await import('@/lib/prisma')

      // Mock Prisma operations
      vi.mocked(prisma.mCPToken.findFirst).mockResolvedValue(mockMcpToken)

      const taskWithLists = {
        ...mockTask,
        lists: [{
          id: 'test-list-id',
          name: 'Test List',
          color: '#3b82f6',
          privacy: 'PRIVATE' as const,
          listMembers: []
        }],
      }

      // Mock both findUnique (used to check if task exists) and findFirst (used for access check)
      vi.mocked(prisma.task.findUnique).mockResolvedValue(taskWithLists)
      vi.mocked(prisma.task.findFirst).mockResolvedValue(taskWithLists)
      vi.mocked(prisma.task.delete).mockResolvedValue(mockTask)

      // Mock list member retrieval - this is called by getListMemberIdsByListId
      vi.mocked(prisma.taskList.findFirst).mockResolvedValue({
        ...mockMcpToken.list,
        id: 'test-list-id',
        owner: { id: 'list-owner-id' },
        listMembers: [
          { id: 'lm-1', listId: 'test-list-id', userId: 'admin-user-id', role: 'admin', user: { id: 'admin-user-id' } },
          { id: 'lm-2', listId: 'test-list-id', userId: 'member-user-id', role: 'member', user: { id: 'member-user-id' } }
        ],
      } as any)

      const request = new NextRequest('http://localhost:3000/api/mcp/operations', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'delete_task',
          args: {
            accessToken: 'test-access-token',
            taskId: 'test-task-id',
          },
        }),
      })

      await POST(request)

      // Verify broadcastToUsers was called with task_deleted event
      expect(broadcastToUsers).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          type: 'task_deleted',
          timestamp: expect.any(String),
          data: expect.objectContaining({
            taskId: 'test-task-id',
            taskTitle: 'Test Task',
            deleterName: 'Test MCP User',
            userId: 'test-user-id',
            listNames: ['Test List'],
          }),
        })
      )
    })
  })

  describe('SSE broadcast error handling', () => {
    it('should not fail MCP operation if SSE broadcast fails', async () => {
      // Mock SSE broadcast to throw error
      vi.mocked(broadcastToUsers).mockImplementation(() => {
        throw new Error('SSE broadcast failed')
      })

      // Import the mocked prisma
      const { prisma } = await import('@/lib/prisma')

      // Mock Prisma operations for successful task creation
      vi.mocked(prisma.mCPToken.findFirst).mockResolvedValue(mockMcpToken)
      vi.mocked(prisma.taskList.findMany).mockResolvedValue([mockMcpToken.list])
      vi.mocked(prisma.task.create).mockResolvedValue(mockTask)

      const request = new NextRequest('http://localhost:3000/api/mcp/operations', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'create_task',
          args: {
            accessToken: 'test-access-token',
            listId: 'test-list-id',
            task: {
              title: 'Test Task',
              description: 'Test task description',
              priority: 1,
            },
          },
        }),
      })

      const response = await POST(request)
      const result = await response.json()

      // MCP operation should still succeed despite SSE failure
      expect(result.success).toBe(true)
      expect(result.task).toBeDefined()
      expect(result.task.id).toBe('test-task-id')
    })
  })
})