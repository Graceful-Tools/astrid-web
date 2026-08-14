/**
 * Task Update Race Condition Tests
 *
 * Tests Redis cache invalidation on v1 PUT/DELETE/POST endpoints
 * and optimistic concurrency control via If-Unmodified-Since.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

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
  getListMemberIds: vi.fn(() => ['user-1', 'user-2']),
  hasListAccess: vi.fn(() => true),
}))

vi.mock('@/lib/agent-protocol', () => ({
  enrichTaskForAgent: vi.fn((task: any) => task),
}))

// Assignee membership validation (PUT/POST reject a non-member assignee):
// allow it so assignment paths reach the cache-invalidation logic.
vi.mock('@/lib/task-assignee', () => ({
  assigneeCanBeAssigned: vi.fn().mockResolvedValue(true),
}))

const mockRedisDel = vi.fn().mockResolvedValue(undefined)
const mockIsRedisAvailable = vi.fn().mockResolvedValue(true)

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    del: (...args: any[]) => mockRedisDel(...args),
    keys: {
      userTasks: (userId: string) => `tasks:user:${userId}`,
    },
  },
  isRedisAvailable: (...args: any[]) => mockIsRedisAvailable(...args),
}))

vi.mock('@/lib/user-stats', () => ({
  invalidateUserStats: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/task-state-change-tracker', () => ({
  detectTaskStateChanges: vi.fn(() => []),
  formatStateChangesAsComment: vi.fn(() => ''),
}))

vi.mock('@/lib/repeating-task-handler', () => ({
  handleRepeatingTaskCompletion: vi.fn().mockResolvedValue(null),
  applyRepeatingTaskRollForward: vi.fn(),
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
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ name: 'Test User', email: 'test@test.com' }),
    },
    comment: {
      create: vi.fn(),
    },
  },
}))

// ── Test Data ──────────────────────────────────────────────────────────

const now = new Date()

const mockList = {
  id: 'list-1',
  name: 'Test List',
  color: '#000',
  description: '',
  ownerId: 'user-1',
  listMembers: [{ userId: 'user-2' }],
  githubRepositoryId: null,
  aiAgentConfiguredBy: null,
}

const mockTask = {
  id: 'task-1',
  title: 'Test Task',
  description: '',
  priority: 0,
  completed: false,
  dueDateTime: null,
  isAllDay: false,
  isPrivate: true,
  repeating: 'never',
  repeatingData: null,
  repeatFrom: 'COMPLETION_DATE',
  assigneeId: 'user-2',
  creatorId: 'user-1',
  clientRequestId: null,
  createdAt: now,
  updatedAt: now,
  lists: [mockList],
  assignee: {
    id: 'user-2',
    name: 'Assignee',
    email: 'assignee@test.com',
    image: null,
    isAIAgent: false,
    aiAgentType: null,
  },
  creator: {
    id: 'user-1',
    name: 'Creator',
    email: 'creator@test.com',
    image: null,
    isAIAgent: false,
  },
  comments: [],
  attachments: [],
}

// ── Helpers ────────────────────────────────────────────────────────────

function makeRequest(url: string, method: string, body?: any, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method,
    ...(body ? { body: JSON.stringify(body) } : {}),
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

// ── Tests: v1 PUT cache invalidation ──────────────────────────────────

describe('v1 PUT — Redis cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRedisAvailable.mockResolvedValue(true)
  })

  it('should invalidate Redis cache for assignee, creator, and list members', async () => {
    const { prisma } = await import('@/lib/prisma')

    // existingTask lookup
    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce(mockTask as any)
    // task.update
    vi.mocked(prisma.task.update).mockResolvedValue(mockTask as any)
    // list member lookup for cache invalidation
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      ...mockList,
      ownerId: 'user-1',
      listMembers: [{ userId: 'user-2' }],
    } as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const req = makeRequest('http://localhost/api/v1/tasks/task-1', 'PUT', {
      title: 'Updated Task',
    })

    const response = await PUT(req, { params: Promise.resolve({ id: 'task-1' }) })
    expect(response.status).toBe(200)

    // Should have called RedisCache.del for affected users
    expect(mockRedisDel).toHaveBeenCalled()

    // Collect all keys that were invalidated
    const deletedKeys = mockRedisDel.mock.calls.map(call => call[0])
    expect(deletedKeys).toContain('tasks:user:user-1') // creator + list owner
    expect(deletedKeys).toContain('tasks:user:user-2') // assignee + list member
  })

  it('should invalidate OLD assignee cache when reassigning', async () => {
    const { prisma } = await import('@/lib/prisma')

    const oldTask = { ...mockTask, assigneeId: 'user-old' }
    const updatedTask = { ...mockTask, assigneeId: 'user-new', assignee: { id: 'user-new', name: 'New', email: 'new@test.com', image: null, isAIAgent: false, aiAgentType: null } }

    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce(oldTask as any)
    vi.mocked(prisma.task.update).mockResolvedValue(updatedTask as any)
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      ...mockList,
      ownerId: 'user-1',
      listMembers: [{ userId: 'user-2' }],
    } as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const req = makeRequest('http://localhost/api/v1/tasks/task-1', 'PUT', {
      assigneeId: 'user-new',
    })

    const response = await PUT(req, { params: Promise.resolve({ id: 'task-1' }) })
    expect(response.status).toBe(200)

    const deletedKeys = mockRedisDel.mock.calls.map(call => call[0])
    expect(deletedKeys).toContain('tasks:user:user-old') // old assignee
    expect(deletedKeys).toContain('tasks:user:user-new') // new assignee
  })

  it('should invalidate user stats on completion change', async () => {
    const { prisma } = await import('@/lib/prisma')

    const existingTask = { ...mockTask, completed: false }
    const completedTask = { ...mockTask, completed: true }

    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce(existingTask as any)
    vi.mocked(prisma.task.update).mockResolvedValue(completedTask as any)
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      ...mockList,
      ownerId: 'user-1',
      listMembers: [{ userId: 'user-2' }],
    } as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const req = makeRequest('http://localhost/api/v1/tasks/task-1', 'PUT', {
      completed: true,
    })

    const response = await PUT(req, { params: Promise.resolve({ id: 'task-1' }) })
    expect(response.status).toBe(200)

    const { invalidateUserStats } = await import('@/lib/user-stats')
    expect(invalidateUserStats).toHaveBeenCalled()
  })
})

// ── Tests: v1 DELETE cache invalidation ───────────────────────────────

describe('v1 DELETE — Redis cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRedisAvailable.mockResolvedValue(true)
  })

  it('should invalidate Redis cache for affected users on delete', async () => {
    const { prisma } = await import('@/lib/prisma')

    // Task lookup before deletion
    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce(mockTask as any)
    // getListMemberIds via taskList lookup
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      ...mockList,
      ownerId: 'user-1',
      owner: { id: 'user-1', name: 'Owner', email: 'owner@test.com', image: null },
      listMembers: [{ userId: 'user-2', user: { id: 'user-2', name: 'Member', email: 'member@test.com', image: null } }],
    } as any)
    // task.delete
    vi.mocked(prisma.task.delete).mockResolvedValue(mockTask as any)

    const { DELETE } = await import('@/app/api/v1/tasks/[id]/route')
    const req = makeRequest('http://localhost/api/v1/tasks/task-1', 'DELETE')

    const response = await DELETE(req, { params: Promise.resolve({ id: 'task-1' }) })
    expect(response.status).toBe(200)

    // Should have called RedisCache.del
    expect(mockRedisDel).toHaveBeenCalled()

    const deletedKeys = mockRedisDel.mock.calls.map(call => call[0])
    // Should include creator, assignee, and deleting user
    expect(deletedKeys).toContain('tasks:user:user-1')
    expect(deletedKeys).toContain('tasks:user:user-2')
  })
})

// ── Tests: v1 POST cache invalidation ─────────────────────────────────

describe('v1 POST — Redis cache invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRedisAvailable.mockResolvedValue(true)
  })

  it('should invalidate Redis cache after task creation', async () => {
    const { prisma } = await import('@/lib/prisma')

    const createdTask = {
      ...mockTask,
      id: 'new-task-1',
      assigneeId: 'user-2',
      lists: [mockList],
    }

    // findUnique for idempotency check (no existing)
    vi.mocked(prisma.task.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.task.create).mockResolvedValue(createdTask as any)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const req = makeRequest('http://localhost/api/v1/tasks', 'POST', {
      title: 'New Task',
      assigneeId: 'user-2',
    })

    const response = await POST(req)
    expect(response.status).toBe(201)

    // Should have called RedisCache.del for creator and list members
    expect(mockRedisDel).toHaveBeenCalled()

    const deletedKeys = mockRedisDel.mock.calls.map(call => call[0])
    expect(deletedKeys).toContain('tasks:user:user-1') // creator
    expect(deletedKeys).toContain('tasks:user:user-2') // assignee + list member
  })
})

// ── Tests: Optimistic concurrency control ─────────────────────────────

describe('v1 PUT — Optimistic concurrency control (If-Unmodified-Since)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRedisAvailable.mockResolvedValue(true)
  })

  it('should return 412 when If-Unmodified-Since is stale', async () => {
    const { prisma } = await import('@/lib/prisma')

    const serverTask = {
      ...mockTask,
      updatedAt: new Date('2026-02-22T12:00:00Z'), // server has newer version
    }

    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce(serverTask as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const req = makeRequest(
      'http://localhost/api/v1/tasks/task-1',
      'PUT',
      { title: 'Updated' },
      { 'If-Unmodified-Since': new Date('2026-02-22T11:00:00Z').toUTCString() } // client has older version
    )

    const response = await PUT(req, { params: Promise.resolve({ id: 'task-1' }) })
    expect(response.status).toBe(412)

    const body = await response.json()
    expect(body.code).toBe('STALE_UPDATE')
    expect(body.task.id).toBe('task-1')

    // Should NOT have called update
    expect(prisma.task.update).not.toHaveBeenCalled()
  })

  it('should proceed when If-Unmodified-Since is fresh', async () => {
    const { prisma } = await import('@/lib/prisma')

    const serverTask = {
      ...mockTask,
      updatedAt: new Date('2026-02-22T11:00:00Z'),
    }

    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce(serverTask as any)
    vi.mocked(prisma.task.update).mockResolvedValue({ ...mockTask, title: 'Updated' } as any)
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      ...mockList,
      ownerId: 'user-1',
      listMembers: [{ userId: 'user-2' }],
    } as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const req = makeRequest(
      'http://localhost/api/v1/tasks/task-1',
      'PUT',
      { title: 'Updated' },
      { 'If-Unmodified-Since': new Date('2026-02-22T12:00:00Z').toUTCString() } // client has newer date
    )

    const response = await PUT(req, { params: Promise.resolve({ id: 'task-1' }) })
    expect(response.status).toBe(200)

    // Should have called update
    expect(prisma.task.update).toHaveBeenCalled()
  })

  it('should proceed when If-Unmodified-Since header is absent', async () => {
    const { prisma } = await import('@/lib/prisma')

    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce(mockTask as any)
    vi.mocked(prisma.task.update).mockResolvedValue(mockTask as any)
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      ...mockList,
      ownerId: 'user-1',
      listMembers: [{ userId: 'user-2' }],
    } as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const req = makeRequest('http://localhost/api/v1/tasks/task-1', 'PUT', {
      title: 'Updated',
    })

    const response = await PUT(req, { params: Promise.resolve({ id: 'task-1' }) })
    expect(response.status).toBe(200)
    expect(prisma.task.update).toHaveBeenCalled()
  })
})

// ── Tests: Create-then-edit flow ──────────────────────────────────────

describe('Create-then-edit flow — cache invalidated at each step', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsRedisAvailable.mockResolvedValue(true)
  })

  it('should invalidate cache on both create and subsequent edit', async () => {
    const { prisma } = await import('@/lib/prisma')

    // Step 1: Create task
    const createdTask = {
      ...mockTask,
      id: 'new-task-1',
      assigneeId: null,
      assignee: null,
      lists: [mockList],
    }

    vi.mocked(prisma.task.findUnique).mockResolvedValue(null)
    vi.mocked(prisma.task.findFirst).mockResolvedValue(null)
    vi.mocked(prisma.task.create).mockResolvedValue(createdTask as any)

    const { POST } = await import('@/app/api/v1/tasks/route')
    const createReq = makeRequest('http://localhost/api/v1/tasks', 'POST', {
      title: 'New Task',
    })

    const createResponse = await POST(createReq)
    expect(createResponse.status).toBe(201)

    const createDelCount = mockRedisDel.mock.calls.length
    expect(createDelCount).toBeGreaterThan(0) // cache was invalidated on create

    // Step 2: Edit task (assign someone)
    vi.clearAllMocks()
    mockIsRedisAvailable.mockResolvedValue(true)

    const editedTask = {
      ...createdTask,
      assigneeId: 'user-3',
      assignee: { id: 'user-3', name: 'New Assignee', email: 'new@test.com', image: null, isAIAgent: false, aiAgentType: null },
    }

    vi.mocked(prisma.task.findUnique).mockResolvedValueOnce(createdTask as any) // existing task lookup
    vi.mocked(prisma.task.update).mockResolvedValue(editedTask as any)
    vi.mocked(prisma.taskList.findUnique).mockResolvedValue({
      ...mockList,
      ownerId: 'user-1',
      listMembers: [{ userId: 'user-2' }],
    } as any)

    const { PUT } = await import('@/app/api/v1/tasks/[id]/route')
    const editReq = makeRequest('http://localhost/api/v1/tasks/new-task-1', 'PUT', {
      assigneeId: 'user-3',
    })

    const editResponse = await PUT(editReq, { params: Promise.resolve({ id: 'new-task-1' }) })
    expect(editResponse.status).toBe(200)

    // Cache invalidated again on edit
    expect(mockRedisDel).toHaveBeenCalled()

    const deletedKeys = mockRedisDel.mock.calls.map(call => call[0])
    expect(deletedKeys).toContain('tasks:user:user-3') // new assignee
    expect(deletedKeys).toContain('tasks:user:user-1') // creator + list owner
  })
})
