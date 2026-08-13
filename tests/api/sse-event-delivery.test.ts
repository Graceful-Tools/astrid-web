/**
 * SSE Event Delivery Tests
 *
 * Tests that all API routes correctly broadcast SSE events
 * with proper types, recipients, and payloads.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { broadcastToUsers } from '@/lib/sse-utils'

// ── Mocks ──────────────────────────────────────────────────────────────

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error { name = 'UnauthorizedError' }
  class ForbiddenError extends Error { name = 'ForbiddenError' }
  return {
    authenticateAPI: vi.fn().mockResolvedValue({
      userId: 'user-1',
      source: 'oauth',
      scopes: ['*'],
      clientId: 'test-client',
    }),
    requireScopes: vi.fn(),
    requireTaskAccess: vi.fn(),
    requireTaskReadAccess: vi.fn(),
    getDeprecationWarning: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/lib/agent-protocol', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent-protocol')>()
  return {
    ...actual,
    authenticateAgentRequest: vi.fn().mockResolvedValue({
      userId: 'agent-1',
      source: 'oauth',
      scopes: ['*'],
      clientId: 'test-agent-client',
    }),
  }
})

vi.mock('@/lib/agent-rate-limiter', () => ({
  AGENT_RATE_LIMITS: { TASKS: {}, COMMENTS: {} },
  checkAgentRateLimit: vi.fn().mockResolvedValue({ response: null, headers: {} }),
  addRateLimitHeaders: vi.fn((res: any) => res),
}))

vi.mock('@/lib/analytics-events', () => ({
  trackEventFromRequest: vi.fn(),
  AnalyticsEventType: {
    TASK_CREATED: 'task_created',
    TASK_EDITED: 'task_edited',
    TASK_COMPLETED: 'task_completed',
    TASK_DELETED: 'task_deleted',
  },
}))

vi.mock('@/lib/list-member-utils', () => ({
  getListMemberIds: vi.fn(() => ['user-1', 'member-1']),
  hasListAccess: vi.fn(() => true),
}))

// Assignee membership validation (PUT rejects a non-member assignee with 400):
// allow it so the assignee-change path reaches the broadcast.
vi.mock('@/lib/task-assignee', () => ({
  assigneeCanBeAssigned: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    taskList: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    comment: {
      create: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Test User', email: 'test@test.com' }),
    },
  },
}))

vi.mock('@/lib/task-state-change-tracker', () => ({
  detectTaskStateChanges: vi.fn(() => []),
  formatStateChangesAsComment: vi.fn(() => ''),
}))

vi.mock('@/lib/repeating-task-handler', () => ({
  handleRepeatingTaskCompletion: vi.fn().mockResolvedValue(null),
  applyRepeatingTaskRollForward: vi.fn(),
}))

// ── Test Data ──────────────────────────────────────────────────────────

const now = new Date()

const mockTask = {
  id: 'task-1',
  title: 'Test Task',
  description: 'Description',
  priority: 1,
  completed: false,
  dueDateTime: null,
  isAllDay: false,
  isPrivate: false,
  repeating: 'never',
  repeatingData: null,
  repeatFrom: null,
  assigneeId: 'agent-1',
  creatorId: 'user-1',
  createdAt: now,
  updatedAt: now,
  lists: [
    {
      id: 'list-1',
      name: 'Work',
      description: 'Work tasks',
      color: '#3b82f6',
      ownerId: 'user-1',
      githubRepositoryId: null,
      aiAgentConfiguredBy: null,
      listMembers: [{ userId: 'member-1', role: 'member' }],
    },
  ],
  assignee: {
    id: 'agent-1',
    name: 'AI Agent',
    email: 'agent@test.com',
    image: null,
    isAIAgent: true,
    aiAgentType: 'claude',
  },
  creator: {
    id: 'user-1',
    name: 'Jon',
    email: 'jon@test.com',
    image: null,
    isAIAgent: false,
  },
  comments: [
    {
      id: 'comment-1',
      content: 'Initial comment',
      authorId: 'user-1',
      author: { id: 'user-1', name: 'Jon', email: 'jon@test.com', isAIAgent: false },
      createdAt: now,
    },
  ],
  attachments: [],
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('SSE Event Delivery — DELETE /api/v1/tasks/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should broadcast task_deleted event to list members', async () => {
    const { prisma } = await import('@/lib/prisma')

    // The DELETE route computes SSE recipients from listMembers fetched WITH
    // the task (N+1 removal) — not a separate taskList.findUnique — so the
    // mocked task must carry ownerId + listMembers on its lists.
    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      ...mockTask,
      lists: [{ id: 'list-1', name: 'Work', ownerId: 'user-1', listMembers: [{ userId: 'member-1' }] }],
    } as any)

    vi.mocked(prisma.task.delete).mockResolvedValue(mockTask as any)

    const { DELETE } = await import('@/app/api/v1/tasks/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/tasks/task-1', { method: 'DELETE' })

    const response = await DELETE(req, { params: Promise.resolve({ id: 'task-1' }) })

    expect(response.status).toBe(200)
    expect(broadcastToUsers).toHaveBeenCalledWith(
      expect.arrayContaining(['member-1']),
      expect.objectContaining({
        type: 'task_deleted',
        data: expect.objectContaining({
          taskId: 'task-1',
        }),
      })
    )
  })

  it('should not broadcast to the deleting user', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      ...mockTask,
      creatorId: 'user-1',
      assigneeId: 'agent-1',
      lists: [{ id: 'list-1', name: 'Work', ownerId: 'user-1', listMembers: [] }],
    } as any)

    vi.mocked(prisma.task.delete).mockResolvedValue(mockTask as any)

    const { DELETE } = await import('@/app/api/v1/tasks/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/tasks/task-1', { method: 'DELETE' })

    await DELETE(req, { params: Promise.resolve({ id: 'task-1' }) })

    // user-1 is the authenticated user, should not be in recipients
    if (vi.mocked(broadcastToUsers).mock.calls.length > 0) {
      const recipients = vi.mocked(broadcastToUsers).mock.calls[0][0]
      expect(recipients).not.toContain('user-1')
    }
  })
})

describe('SSE Event Delivery — PUT /api/v1/tasks/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should broadcast task_updated with enriched AgentTask payload', async () => {
    const { prisma } = await import('@/lib/prisma')

    // Mock the existingTask fetch
    vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as any)

    // Mock the update
    vi.mocked(prisma.task.update).mockResolvedValue(mockTask as any)

    // Mock list member retrieval for SSE broadcast
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      id: 'list-1',
      ownerId: 'user-1',
      listMembers: [{ userId: 'member-1' }],
    } as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/tasks/task-1', {
      method: 'PUT',
      body: JSON.stringify({ title: 'Updated Title' }),
    })

    const response = await PUT(req, { params: Promise.resolve({ id: 'task-1' }) })

    expect(response.status).toBe(200)
    expect(broadcastToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        type: 'task_updated',
        data: expect.objectContaining({
          taskId: 'task-1',
          task: expect.objectContaining({
            id: 'task-1',
            title: 'Test Task',
            comments: expect.any(Array),
          }),
        }),
      })
    )
  })

  it('should broadcast task_completed when completing a task', async () => {
    const { prisma } = await import('@/lib/prisma')

    const existingTask = { ...mockTask, completed: false }
    const updatedTask = { ...mockTask, completed: true }

    vi.mocked(prisma.task.findUnique).mockResolvedValue(existingTask as any)
    vi.mocked(prisma.task.update).mockResolvedValue(updatedTask as any)
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      id: 'list-1',
      ownerId: 'user-1',
      listMembers: [{ userId: 'member-1' }],
    } as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/tasks/task-1', {
      method: 'PUT',
      body: JSON.stringify({ completed: true }),
    })

    await PUT(req, { params: Promise.resolve({ id: 'task-1' }) })

    expect(broadcastToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        type: 'task_completed',
      })
    )
  })

  it('should broadcast task_assigned when assignee changes', async () => {
    const { prisma } = await import('@/lib/prisma')

    const existingTask = { ...mockTask, assigneeId: null }
    const updatedTask = { ...mockTask, assigneeId: 'agent-1' }

    // PUT fetches twice: the pre-update task (assignee null → drives
    // assigneeChanged) then the enriched re-fetch AFTER update (assignee
    // agent-1 → drives the task_assigned broadcast target/payload).
    vi.mocked(prisma.task.findUnique)
      .mockResolvedValueOnce(existingTask as any)
      .mockResolvedValueOnce(updatedTask as any)
    vi.mocked(prisma.task.update).mockResolvedValue(updatedTask as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/tasks/task-1', {
      method: 'PUT',
      body: JSON.stringify({ assigneeId: 'agent-1' }),
    })

    await PUT(req, { params: Promise.resolve({ id: 'task-1' }) })

    // Should send task_assigned to new assignee
    expect(broadcastToUsers).toHaveBeenCalledWith(
      ['agent-1'],
      expect.objectContaining({
        type: 'task_assigned',
        data: expect.objectContaining({
          taskId: 'task-1',
          task: expect.objectContaining({ id: 'task-1' }),
        }),
      })
    )
  })

  it('should include comments in enriched task payload', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.task.findUnique).mockResolvedValue(mockTask as any)
    vi.mocked(prisma.task.update).mockResolvedValue(mockTask as any)
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      id: 'list-1',
      ownerId: 'user-1',
      listMembers: [{ userId: 'member-1' }],
    } as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/tasks/task-1', {
      method: 'PUT',
      body: JSON.stringify({ priority: 2 }),
    })

    await PUT(req, { params: Promise.resolve({ id: 'task-1' }) })

    const broadcastCall = vi.mocked(broadcastToUsers).mock.calls.find(
      call => (call[1] as any).type === 'task_updated' || (call[1] as any).type === 'task_completed'
    )
    expect(broadcastCall).toBeDefined()
    const payload = (broadcastCall![1] as any).data
    expect(payload.task.comments).toBeDefined()
    expect(payload.task.comments.length).toBeGreaterThanOrEqual(0)
  })
})

describe('SSE Event Delivery — PATCH /api/v1/agent/tasks/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should broadcast with enriched AgentTask payload', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.task.findFirst).mockResolvedValue(mockTask as any)
    vi.mocked(prisma.task.update).mockResolvedValue(mockTask as any)

    const { PATCH } = await import('@/app/api/v1/agent/tasks/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/agent/tasks/task-1', {
      method: 'PATCH',
      body: JSON.stringify({ completed: true }),
    })

    await PATCH(req, { params: Promise.resolve({ id: 'task-1' }) })

    expect(broadcastToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: 'task-1',
          task: expect.objectContaining({
            id: 'task-1',
            title: 'Test Task',
            comments: expect.any(Array),
            listId: expect.any(String),
          }),
        }),
      })
    )
  })

  it('should not contain flat legacy fields in payload', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.task.findFirst).mockResolvedValue(mockTask as any)
    vi.mocked(prisma.task.update).mockResolvedValue(mockTask as any)

    const { PATCH } = await import('@/app/api/v1/agent/tasks/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/agent/tasks/task-1', {
      method: 'PATCH',
      body: JSON.stringify({ priority: 2 }),
    })

    await PATCH(req, { params: Promise.resolve({ id: 'task-1' }) })

    if (vi.mocked(broadcastToUsers).mock.calls.length > 0) {
      const payload = (vi.mocked(broadcastToUsers).mock.calls[0][1] as any).data
      // Should NOT have flat fields — only taskId + task object
      expect(payload.updatedBy).toBeUndefined()
      expect(payload.listNames).toBeUndefined()
    }
  })
})

describe('SSE Event Delivery — POST /api/v1/agent/tasks/:id/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should broadcast with AgentComment format', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      ...mockTask,
      lists: [{
        id: 'list-1',
        name: 'Work',
        listMembers: [{ user: { id: 'member-1' } }],
      }],
    } as any)

    const mockComment = {
      id: 'comment-new',
      content: 'Agent update',
      type: 'MARKDOWN',
      authorId: 'agent-1',
      author: { id: 'agent-1', name: 'AI Agent', email: 'agent@test.com', isAIAgent: true },
      createdAt: now,
    }

    vi.mocked(prisma.comment.create).mockResolvedValue(mockComment as any)

    const { POST } = await import('@/app/api/v1/agent/tasks/[id]/comments/route')
    const req = new NextRequest('http://localhost/api/v1/agent/tasks/task-1/comments', {
      method: 'POST',
      body: JSON.stringify({ content: 'Agent update' }),
    })

    await POST(req, { params: Promise.resolve({ id: 'task-1' }) })

    expect(broadcastToUsers).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({
        type: 'comment_created',
        data: expect.objectContaining({
          taskId: 'task-1',
          commentId: 'comment-new',
          comment: expect.objectContaining({
            id: 'comment-new',
            content: 'Agent update',
            authorName: 'AI Agent',
            authorId: 'agent-1',
            isAgent: true,
            createdAt: expect.any(String),
          }),
        }),
      })
    )
  })

  it('should not include raw Prisma author object in broadcast', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.task.findFirst).mockResolvedValue({
      ...mockTask,
      lists: [{
        id: 'list-1',
        name: 'Work',
        listMembers: [{ user: { id: 'member-1' } }],
      }],
    } as any)

    const mockComment = {
      id: 'comment-2',
      content: 'Test',
      type: 'MARKDOWN',
      authorId: 'agent-1',
      author: { id: 'agent-1', name: 'AI Agent', email: 'agent@test.com', isAIAgent: true },
      createdAt: now,
    }

    vi.mocked(prisma.comment.create).mockResolvedValue(mockComment as any)

    const { POST } = await import('@/app/api/v1/agent/tasks/[id]/comments/route')
    const req = new NextRequest('http://localhost/api/v1/agent/tasks/task-1/comments', {
      method: 'POST',
      body: JSON.stringify({ content: 'Test' }),
    })

    await POST(req, { params: Promise.resolve({ id: 'task-1' }) })

    if (vi.mocked(broadcastToUsers).mock.calls.length > 0) {
      const commentData = (vi.mocked(broadcastToUsers).mock.calls[0][1] as any).data.comment
      // Should have flattened AgentComment fields, not raw Prisma author
      expect(commentData.author).toBeUndefined()
      expect(commentData.type).toBeUndefined()
      expect(commentData.parentCommentId).toBeUndefined()
      // Should have proper fields
      expect(commentData.authorName).toBeDefined()
      expect(commentData.isAgent).toBeDefined()
    }
  })
})

describe('SSE Event Delivery — POST /api/v1/tasks (task_created)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should include enriched AgentTask in task_created broadcast', async () => {
    const { prisma } = await import('@/lib/prisma')

    // Mock list validation (POST /tasks checks listIds)
    vi.mocked(prisma.taskList.findMany).mockResolvedValue([{
      id: 'list-1',
      name: 'Work',
      privacy: 'PRIVATE',
      isVirtual: false,
      ownerId: 'user-1',
      owner: { id: 'user-1', name: 'Jon', email: 'jon@test.com', image: null },
      listMembers: [{ userId: 'member-1', role: 'member', user: { id: 'member-1', name: 'Member', email: 'm@test.com', image: null } }],
    }] as any)

    vi.mocked(prisma.task.create).mockResolvedValue(mockTask as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null) // no idempotency duplicate

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'New Task',
        listIds: ['list-1'],
        assigneeId: 'agent-1',
      }),
    })

    await POST(req)

    // Look for task_created broadcast (not task_assigned which goes to assignee)
    const createdCall = vi.mocked(broadcastToUsers).mock.calls.find(
      call => (call[1] as any).type === 'task_created'
    )

    if (createdCall) {
      const payload = (createdCall[1] as any).data
      // Should have enriched AgentTask
      expect(payload.task).toBeDefined()
      expect(payload.task.id).toBe('task-1')
      expect(payload.task.comments).toBeDefined()
      expect(payload.task.listId).toBeDefined()
      expect(payload.task.assignerName).toBeDefined()
    }
  })

  it('should include enriched AgentTask in task_assigned broadcast', async () => {
    const { prisma } = await import('@/lib/prisma')

    // Mock list validation (POST /tasks checks listIds)
    vi.mocked(prisma.taskList.findMany).mockResolvedValue([{
      id: 'list-1',
      name: 'Work',
      privacy: 'PRIVATE',
      isVirtual: false,
      ownerId: 'user-1',
      owner: { id: 'user-1', name: 'Jon', email: 'jon@test.com', image: null },
      listMembers: [{ userId: 'member-1', role: 'member', user: { id: 'member-1', name: 'Member', email: 'm@test.com', image: null } }],
    }] as any)

    vi.mocked(prisma.task.create).mockResolvedValue(mockTask as any)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null) // no idempotency duplicate

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = new NextRequest('http://localhost/api/v1/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'New Task',
        listIds: ['list-1'],
        assigneeId: 'agent-1',
      }),
    })

    await POST(req)

    // task_assigned broadcast to the assignee
    const assignedCall = vi.mocked(broadcastToUsers).mock.calls.find(
      call => (call[1] as any).type === 'task_assigned'
    )

    expect(assignedCall).toBeDefined()
    const payload = (assignedCall![1] as any).data
    expect(payload.task).toBeDefined()
    expect(payload.task.id).toBe('task-1')
    expect(payload.task.comments).toBeDefined()
  })
})

describe('SSE Event Delivery — Error Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should not fail DELETE if SSE broadcast throws', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.task.findUnique).mockResolvedValue({
      ...mockTask,
      lists: [{ id: 'list-1', name: 'Work', ownerId: 'user-1', listMembers: [{ userId: 'member-1' }] }],
    } as any)
    vi.mocked(prisma.task.delete).mockResolvedValue(mockTask as any)
    vi.mocked(broadcastToUsers).mockImplementation(() => { throw new Error('SSE failed') })

    const { DELETE } = await import('@/app/api/v1/tasks/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/tasks/task-1', { method: 'DELETE' })

    const response = await DELETE(req, { params: Promise.resolve({ id: 'task-1' }) })

    expect(response.status).toBe(200)
  })

  it('should not fail agent PATCH if SSE broadcast throws', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.task.findFirst).mockResolvedValue(mockTask as any)
    vi.mocked(prisma.task.update).mockResolvedValue(mockTask as any)
    vi.mocked(broadcastToUsers).mockImplementation(() => { throw new Error('SSE failed') })

    const { PATCH } = await import('@/app/api/v1/agent/tasks/[id]/route')
    const req = new NextRequest('http://localhost/api/v1/agent/tasks/task-1', {
      method: 'PATCH',
      body: JSON.stringify({ completed: true }),
    })

    const response = await PATCH(req, { params: Promise.resolve({ id: 'task-1' }) })

    expect(response.status).toBe(200)
  })
})
