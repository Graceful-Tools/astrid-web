import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    comment: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
  },
}))

// Mock auth
vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error { name = 'UnauthorizedError' }
  class ForbiddenError extends Error { name = 'ForbiddenError' }
  return { authenticateAPI: vi.fn(), UnauthorizedError, ForbiddenError }
})

vi.mock('@/lib/oauth/oauth-scopes', () => ({
  hasRequiredScopes: vi.fn(() => true),
}))

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

vi.mock('@/lib/list-member-utils', () => ({
  getListMemberIds: vi.fn(() => []),
}))

import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { GET as getTasks } from '@/app/api/v1/agent/tasks/route'
import { GET as getTask, PATCH as patchTask } from '@/app/api/v1/agent/tasks/[id]/route'
import { GET as getComments, POST as postComment } from '@/app/api/v1/agent/tasks/[id]/comments/route'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const AUTH_CONTEXT = { userId: 'agent-1', scopes: ['tasks:read', 'tasks:write', 'comments:read', 'comments:write'] }

function makeReq(url: string, opts?: RequestInit) {
  return new NextRequest(`http://localhost${url}`, opts)
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

const sampleTask = {
  id: 'task-1',
  title: 'Test',
  description: 'Desc',
  priority: 1,
  completed: false,
  dueDateTime: new Date('2026-03-01T00:00:00Z'),
  isAllDay: false,
  createdAt: new Date('2026-02-01T00:00:00Z'),
  updatedAt: new Date('2026-02-15T00:00:00Z'),
  creatorId: 'user-1',
  lists: [{ id: 'l1', name: 'List', description: 'Instructions' }],
  creator: { id: 'user-1', name: 'Jon', email: 'j@e.com' },
  comments: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(AUTH_CONTEXT as any)
})

describe('GET /api/v1/agent/tasks', () => {
  it('returns tasks assigned to agent', async () => {
    mockPrisma.task.findMany.mockResolvedValue([sampleTask] as any)
    const res = await getTasks(makeReq('/api/v1/agent/tasks'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.tasks).toHaveLength(1)
    expect(json.tasks[0].id).toBe('task-1')
  })

  it('passes completed filter', async () => {
    mockPrisma.task.findMany.mockResolvedValue([])
    await getTasks(makeReq('/api/v1/agent/tasks?completed=true'))
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ completed: true }) })
    )
  })

  it('returns 401 on auth failure', async () => {
    const { UnauthorizedError } = await import('@/lib/api-auth-middleware')
    mockAuth.mockRejectedValue(new UnauthorizedError('bad'))
    const res = await getTasks(makeReq('/api/v1/agent/tasks'))
    expect(res.status).toBe(401)
  })
})

describe('GET /api/v1/agent/tasks/:id', () => {
  it('returns single task', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask as any)
    const res = await getTask(makeReq('/api/v1/agent/tasks/task-1'), makeContext('task-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.task.id).toBe('task-1')
  })

  it('returns 404 for non-existent', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null)
    const res = await getTask(makeReq('/api/v1/agent/tasks/nope'), makeContext('nope'))
    expect(res.status).toBe(404)
  })
})

describe('PATCH /api/v1/agent/tasks/:id', () => {
  it('completes a task', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask as any)
    mockPrisma.task.update.mockResolvedValue({ ...sampleTask, completed: true } as any)
    const res = await patchTask(
      makeReq('/api/v1/agent/tasks/task-1', { method: 'PATCH', body: JSON.stringify({ completed: true }) }),
      makeContext('task-1')
    )
    expect(res.status).toBe(200)
    expect(mockPrisma.task.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ completed: true }),
    }))
  })

  it('updates priority', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(sampleTask as any)
    mockPrisma.task.update.mockResolvedValue({ ...sampleTask, priority: 3 } as any)
    const res = await patchTask(
      makeReq('/api/v1/agent/tasks/task-1', { method: 'PATCH', body: JSON.stringify({ priority: 3 }) }),
      makeContext('task-1')
    )
    expect(res.status).toBe(200)
  })

  it('returns 404 for wrong agent', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null)
    const res = await patchTask(
      makeReq('/api/v1/agent/tasks/task-1', { method: 'PATCH', body: JSON.stringify({ completed: true }) }),
      makeContext('task-1')
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/agent/tasks/:id/comments', () => {
  it('returns comments in order', async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ id: 'task-1' } as any)
    mockPrisma.comment.findMany.mockResolvedValue([
      { id: 'c1', content: 'First', authorId: 'u1', createdAt: new Date('2026-02-10T00:00:00Z'), author: { id: 'u1', name: 'Jon', email: 'j@e.com', isAIAgent: false } },
      { id: 'c2', content: 'Second', authorId: 'agent-1', createdAt: new Date('2026-02-11T00:00:00Z'), author: { id: 'agent-1', name: 'Agent', email: 'a@e.com', isAIAgent: true } },
    ] as any)
    const res = await getComments(makeReq('/api/v1/agent/tasks/task-1/comments'), makeContext('task-1'))
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.comments).toHaveLength(2)
    expect(json.comments[0].content).toBe('First')
    expect(json.comments[1].isAgent).toBe(true)
  })

  it('returns 404 for inaccessible task', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null)
    const res = await getComments(makeReq('/api/v1/agent/tasks/nope/comments'), makeContext('nope'))
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/agent/tasks/:id/comments', () => {
  it('creates a comment', async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ ...sampleTask, lists: [] } as any)
    mockPrisma.comment.create.mockResolvedValue({
      id: 'c-new', content: 'Hello', authorId: 'agent-1', createdAt: new Date('2026-02-16T00:00:00Z'),
      author: { id: 'agent-1', name: 'Agent', email: 'a@e.com', isAIAgent: true },
    } as any)
    const res = await postComment(
      makeReq('/api/v1/agent/tasks/task-1/comments', { method: 'POST', body: JSON.stringify({ content: 'Hello' }) }),
      makeContext('task-1')
    )
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.comment.content).toBe('Hello')
    expect(json.comment.isAgent).toBe(true)
  })

  it('validates content is required', async () => {
    mockPrisma.task.findFirst.mockResolvedValue({ ...sampleTask, lists: [] } as any)
    const res = await postComment(
      makeReq('/api/v1/agent/tasks/task-1/comments', { method: 'POST', body: JSON.stringify({}) }),
      makeContext('task-1')
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 for inaccessible task', async () => {
    mockPrisma.task.findFirst.mockResolvedValue(null)
    const res = await postComment(
      makeReq('/api/v1/agent/tasks/nope/comments', { method: 'POST', body: JSON.stringify({ content: 'Hi' }) }),
      makeContext('nope')
    )
    expect(res.status).toBe(404)
  })

  it('returns 401 on auth failure', async () => {
    const { UnauthorizedError } = await import('@/lib/api-auth-middleware')
    mockAuth.mockRejectedValue(new UnauthorizedError('bad'))
    const res = await postComment(
      makeReq('/api/v1/agent/tasks/task-1/comments', { method: 'POST', body: JSON.stringify({ content: 'Hi' }) }),
      makeContext('task-1')
    )
    expect(res.status).toBe(401)
  })
})
