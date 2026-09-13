import { describe, it, expect, beforeEach, vi } from 'vitest'
import { row, rowWith, rows } from '../fixtures/prisma-rows'
import { NextRequest } from 'next/server'
import { mockPrisma } from '../setup'
import { GET, POST } from '@/app/api/v1/tasks/[id]/comments/route'
import { authenticateAPI, requireScopes, getDeprecationWarning } from '@/lib/api-auth-middleware'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

vi.mock('@/lib/list-member-utils', () => ({
  getListMemberIds: vi.fn().mockReturnValue(rows([])),
}))

const mockAuthenticateAPI = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)
const mockGetDeprecationWarning = vi.mocked(getDeprecationWarning)
const mockBroadcastToUsers = vi.mocked(broadcastToUsers)
const mockGetListMemberIds = vi.mocked(getListMemberIds)

const createPublicList = (overrides: Partial<any> = {}) => ({
  id: 'list-public',
  name: 'Public List',
  ownerId: 'owner-id',
  privacy: 'PUBLIC',
  publicListType: 'copy_only',
  createdAt: new Date(),
  updatedAt: new Date(),
  owner: {
    id: 'owner-id',
    email: 'owner@example.com',
    name: 'Owner',
    image: null,
  },
  listMembers: [],
  ...overrides,
})

const createComment = () => ({
  id: 'comment-1',
  content: 'First!',
  type: 'TEXT',
  authorId: 'owner-id',
  taskId: 'task-id',
  createdAt: new Date(),
  updatedAt: new Date(),
  parentCommentId: null,
  author: {
    id: 'owner-id',
    name: 'Owner',
    email: 'owner@example.com',
    image: null,
  },
  secureFiles: [],
})

describe('API v1 task comments public access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireScopes.mockImplementation(() => {})
    mockGetDeprecationWarning.mockReturnValue(undefined)
    mockGetListMemberIds.mockReturnValue(rows(['owner-id']))
  })

  it('allows viewing comments on public lists without membership', async () => {
    mockAuthenticateAPI.mockResolvedValue(row({
      userId: 'viewer-id',
      source: 'oauth',
      scopes: ['comments:read'],
    }))

    mockPrisma.task.findUnique.mockResolvedValue(row({
      id: 'task-public',
      creatorId: 'owner-id',
      assigneeId: null,
      lists: [createPublicList()],
    }))

    const mockComments = [createComment()]
    mockPrisma.comment.findMany.mockResolvedValue(mockComments)

    const request = new NextRequest('http://localhost:3000/api/v1/tasks/task-public/comments')
    const response = await GET(request, { params: Promise.resolve({ id: 'task-public' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.comments).toHaveLength(1)
    expect(mockPrisma.comment.findMany).toHaveBeenCalledWith({
      where: { taskId: 'task-public' },
      include: {
        author: {
          select: { id: true, name: true, email: true, image: true, isAIAgent: true },
        },
        secureFiles: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            fileSize: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 2500,
    })
  })

  it('allows collaborative public list viewers to add comments', async () => {
    mockAuthenticateAPI.mockResolvedValue(row({
      userId: 'viewer-id',
      source: 'oauth',
      scopes: ['comments:write'],
    }))

    mockPrisma.task.findUnique.mockResolvedValue(row({
      id: 'task-collab',
      creatorId: 'owner-id',
      assigneeId: null,
      lists: [
        createPublicList({
          id: 'list-collab',
          publicListType: 'collaborative',
        }),
      ],
    }))

    const createdComment = {
      ...createComment(),
      id: 'comment-new',
      content: 'Excited to help!',
      authorId: 'viewer-id',
      author: {
        id: 'viewer-id',
        name: 'Viewer',
        email: 'viewer@example.com',
        image: null,
      },
    }

    mockPrisma.comment.create.mockResolvedValue(createdComment)
    mockPrisma.secureFile.update.mockResolvedValue(undefined as any)

    const request = new NextRequest('http://localhost:3000/api/v1/tasks/task-collab/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Excited to help!' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'task-collab' }) })
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.comment.content).toBe('Excited to help!')
    expect(mockPrisma.comment.create).toHaveBeenCalledWith({
      data: {
        content: 'Excited to help!',
        type: 'TEXT',
        authorId: 'viewer-id',
        taskId: 'task-collab',
        parentCommentId: null,
        clientRequestId: null,
      },
      include: {
        author: {
          select: { id: true, name: true, email: true, image: true, isAIAgent: true },
        },
        secureFiles: {
          select: {
            id: true,
            originalName: true,
            mimeType: true,
            fileSize: true,
            createdAt: true,
          },
        },
      },
    })
    expect(mockBroadcastToUsers).toHaveBeenCalled()
  })

  it('returns existing comment when clientRequestId matches a prior submit (offline retry)', async () => {
    mockAuthenticateAPI.mockResolvedValue(row({
      userId: 'author-id',
      source: 'oauth',
      scopes: ['comments:write'],
    }))

    const existing = {
      ...createComment(),
      id: 'comment-existing',
      content: 'bam',
      authorId: 'author-id',
      taskId: 'task-id',
      clientRequestId: 'client-req-12345678',
    }
    mockPrisma.comment.findUnique.mockResolvedValue(existing)

    const request = new NextRequest('http://localhost:3000/api/v1/tasks/task-id/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'bam', clientRequestId: 'client-req-12345678' }),
    })

    // Even though we don't set up task.findUnique, the idempotency lookup happens
    // AFTER the access check, so we still need the task mock
    mockPrisma.task.findUnique.mockResolvedValue(row({
      id: 'task-id',
      creatorId: 'author-id',
      assigneeId: null,
      lists: [createPublicList({ id: 'list-id', publicListType: 'collaborative' })],
    }))

    const response = await POST(request, { params: Promise.resolve({ id: 'task-id' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.meta.idempotent).toBe(true)
    expect(data.comment.id).toBe('comment-existing')
    expect(mockPrisma.comment.create).not.toHaveBeenCalled()
  })

  it('rejects copy-only public list comments from non-members', async () => {
    mockAuthenticateAPI.mockResolvedValue(row({
      userId: 'viewer-id',
      source: 'oauth',
      scopes: ['comments:write'],
    }))

    mockPrisma.task.findUnique.mockResolvedValue(row({
      id: 'task-copy',
      creatorId: 'owner-id',
      assigneeId: null,
      lists: [createPublicList()],
    }))

    const request = new NextRequest('http://localhost:3000/api/v1/tasks/task-copy/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Let me contribute' }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'task-copy' }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('Task not found or access denied')
    expect(mockPrisma.comment.create).not.toHaveBeenCalled()
  })
})
