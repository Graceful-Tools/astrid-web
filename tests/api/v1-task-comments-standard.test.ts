import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn() },
    comment: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    secureFile: { findUnique: vi.fn(), update: vi.fn() },
  },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

vi.mock('@/lib/sse-utils', () => ({ broadcastToUsers: vi.fn() }))
vi.mock('@/lib/list-member-utils', () => ({ getListMemberIds: vi.fn(() => []) }))
vi.mock('@/lib/comments/post-comment-side-effects', () => ({
  dispatchPostCommentSideEffects: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { COMMENT_ADDED: 'COMMENT_ADDED' },
  trackEventFromRequest: vi.fn(),
}))

import { GET, POST } from '@/app/api/v1/tasks/[id]/comments/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const authedUser = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['comments:read', 'comments:write'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(method: 'GET' | 'POST', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/tasks/task-1/comments', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const params = Promise.resolve({ id: 'task-1' })

const ownTask = {
  id: 'task-1',
  title: 'Fix bug',
  creatorId: 'user-1',
  assigneeId: null,
  lists: [{
    id: 'list-1',
    name: 'My List',
    ownerId: 'user-1',
    privacy: 'PRIVATE',
    publicListType: null,
    listMembers: [],
    githubRepositoryId: null,
    aiAgentConfiguredBy: null,
  }],
  assignee: null,
}

const foreignTask = {
  ...ownTask,
  creatorId: 'someone-else',
  lists: [{
    ...ownTask.lists[0],
    ownerId: 'someone-else',
  }],
}

describe('GET /api/v1/tasks/:id/comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 404 when task does not exist', async () => {
    ;(mockPrisma.task.findUnique as any).mockResolvedValue(null)
    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 404 when caller is not on the task and it is not public', async () => {
    ;(mockPrisma.task.findUnique as any).mockResolvedValue(foreignTask)
    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns comments when caller is the task creator', async () => {
    ;(mockPrisma.task.findUnique as any).mockResolvedValue(ownTask)
    ;(mockPrisma.comment.findMany as any).mockResolvedValue([
      { id: 'c-1', content: 'hi', author: { id: 'user-1' }, secureFiles: [] },
    ])

    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.comments).toHaveLength(1)
    expect(json.meta).toMatchObject({ total: 1, taskId: 'task-1' })
  })
})

describe('POST /api/v1/tasks/:id/comments — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 400 when content is not a string', async () => {
    const res = await POST(makeReq('POST', { content: 42 }), { params } as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when content is empty and no fileId', async () => {
    const res = await POST(makeReq('POST', { content: '   ' }), { params } as any)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/v1/tasks/:id/comments — access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 404 when task does not exist', async () => {
    ;(mockPrisma.task.findUnique as any).mockResolvedValue(null)
    const res = await POST(makeReq('POST', { content: 'hi' }), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 404 when caller has no access and task is not collaborative-public', async () => {
    ;(mockPrisma.task.findUnique as any).mockResolvedValue(foreignTask)
    const res = await POST(makeReq('POST', { content: 'hi' }), { params } as any)
    expect(res.status).toBe(404)
  })

  it('creates a comment when caller is the task creator', async () => {
    ;(mockPrisma.task.findUnique as any).mockResolvedValue(ownTask)
    ;(mockPrisma.comment.create as any).mockResolvedValue({
      id: 'c-1',
      content: 'hello',
      authorId: 'user-1',
      createdAt: new Date(),
      author: { id: 'user-1', isAIAgent: false },
      secureFiles: [],
    })
    ;(mockPrisma.user.findUnique as any).mockResolvedValue({
      id: 'user-1', name: 'Jon', email: 'jon@example.com', isAIAgent: false,
    })

    const res = await POST(makeReq('POST', { content: 'hello' }), { params } as any)
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.comment.id).toBe('c-1')
  })
})

describe('POST /api/v1/tasks/:id/comments — aiAgentId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
    ;(mockPrisma.task.findUnique as any).mockResolvedValue(ownTask)
  })

  it('returns 400 when aiAgentId user does not exist', async () => {
    ;(mockPrisma.user.findUnique as any).mockResolvedValue(null)
    const res = await POST(
      makeReq('POST', { content: 'as agent', aiAgentId: 'agent-x' }),
      { params } as any
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when aiAgentId user is not an AI agent and not @astrid.cc', async () => {
    ;(mockPrisma.user.findUnique as any).mockResolvedValue({
      id: 'human-1', isAIAgent: false, email: 'someone@gmail.com',
    })
    const res = await POST(
      makeReq('POST', { content: 'as agent', aiAgentId: 'human-1' }),
      { params } as any
    )
    expect(res.status).toBe(400)
  })

  it('accepts a system @astrid.cc agent even if isAIAgent is false', async () => {
    ;(mockPrisma.user.findUnique as any).mockImplementation((args: any) => {
      if (args.where.id === 'system-agent') {
        return Promise.resolve({ id: 'system-agent', isAIAgent: false, email: 'claude@astrid.cc' })
      }
      // commenterUser lookup
      return Promise.resolve({ id: 'user-1', name: 'Jon', email: 'jon@example.com', isAIAgent: false })
    })
    ;(mockPrisma.comment.create as any).mockResolvedValue({
      id: 'c-1',
      content: 'as agent',
      authorId: 'system-agent',
      createdAt: new Date(),
      author: { id: 'system-agent', isAIAgent: false },
      secureFiles: [],
    })

    const res = await POST(
      makeReq('POST', { content: 'as agent', aiAgentId: 'system-agent' }),
      { params } as any
    )
    expect(res.status).toBe(201)
    const createCall = (mockPrisma.comment.create as any).mock.calls[0][0]
    expect(createCall.data.authorId).toBe('system-agent')
  })
})
