import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    comment: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
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

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

vi.mock('@/lib/list-member-utils', () => ({
  getListMemberIds: vi.fn(() => []),
}))

vi.mock('@/lib/analytics-events', () => ({
  AnalyticsEventType: { COMMENT_DELETED: 'COMMENT_DELETED' },
  trackEventFromRequest: vi.fn(),
}))

import { GET, PUT, DELETE } from '@/app/api/v1/comments/[id]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const authedUser = {
  userId: 'user-123',
  source: 'oauth' as const,
  scopes: ['comments:read', 'comments:write', 'comments:delete'],
  isAIAgent: false,
  user: { id: 'user-123', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(method: 'GET' | 'PUT' | 'DELETE', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/comments/comment-1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const params = Promise.resolve({ id: 'comment-1' })

describe('GET /api/v1/comments/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 404 when comment does not exist', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(null as any)
    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not on the parent task', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue({
      id: 'comment-1',
      authorId: 'someone-else',
      task: {
        id: 'task-1',
        creatorId: 'someone-else',
        assigneeId: null,
        lists: [{ id: 'list-1', ownerId: 'another-user', listMembers: [] }],
      },
    } as any)

    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(403)
  })

  it('returns the comment without exposing the parent task', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue({
      id: 'comment-1',
      content: 'hello',
      authorId: 'user-123',
      author: { id: 'user-123', name: 'Jon', email: 'jon@example.com', image: null },
      secureFiles: [],
      task: {
        id: 'task-1',
        creatorId: 'user-123',
        assigneeId: null,
        lists: [],
      },
    } as any)

    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.comment.id).toBe('comment-1')
    expect(json.comment.content).toBe('hello')
    expect(json.comment.task).toBeUndefined()
    expect(json.meta).toMatchObject({ apiVersion: 'v1' })
  })
})

describe('PUT /api/v1/comments/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 400 when content is missing', async () => {
    const res = await PUT(makeReq('PUT', {}), { params } as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when comment is not found', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue(null as any)
    const res = await PUT(makeReq('PUT', { content: 'updated' }), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller is not the author', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue({ authorId: 'someone-else' } as any)
    const res = await PUT(makeReq('PUT', { content: 'updated' }), { params } as any)
    expect(res.status).toBe(403)
  })

  it('updates and returns the comment when caller is the author', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue({ authorId: 'user-123' } as any)
    mockPrisma.comment.update.mockResolvedValue({
      id: 'comment-1',
      content: 'updated',
      author: { id: 'user-123', name: 'Jon', email: 'jon@example.com', image: null },
      secureFiles: [],
    } as any)

    const res = await PUT(makeReq('PUT', { content: 'updated' }), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.comment.content).toBe('updated')
    expect(mockPrisma.comment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'comment-1' }, data: expect.objectContaining({ content: 'updated' }) })
    )
  })
})

describe('DELETE /api/v1/comments/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 403 when caller has no permission path', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue({
      id: 'comment-1',
      authorId: 'someone-else',
      task: {
        id: 'task-1',
        title: 'T',
        creatorId: 'creator',
        assigneeId: 'assignee',
        lists: [{ id: 'list-1', ownerId: 'owner', listMembers: [] }],
      },
      author: { id: 'someone-else' },
    } as any)

    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(403)
  })

  it('deletes when caller is the comment author', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue({
      id: 'comment-1',
      authorId: 'user-123',
      task: {
        id: 'task-1',
        title: 'T',
        creatorId: 'creator',
        assigneeId: null,
        lists: [],
      },
      author: { id: 'user-123' },
    } as any)
    mockPrisma.comment.delete.mockResolvedValue({} as any)

    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(200)
    expect(mockPrisma.comment.delete).toHaveBeenCalledWith({ where: { id: 'comment-1' } })
  })

  it('deletes when caller is a list admin', async () => {
    mockPrisma.comment.findUnique.mockResolvedValue({
      id: 'comment-1',
      authorId: 'someone-else',
      task: {
        id: 'task-1',
        title: 'T',
        creatorId: 'someone-else',
        assigneeId: null,
        lists: [{
          id: 'list-1',
          ownerId: 'owner',
          listMembers: [{ userId: 'user-123', role: 'admin' }],
        }],
      },
      author: { id: 'someone-else' },
    } as any)
    mockPrisma.comment.delete.mockResolvedValue({} as any)

    const res = await DELETE(makeReq('DELETE'), { params } as any)
    expect(res.status).toBe(200)
  })
})
