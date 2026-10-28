import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/lists/[id]/route'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'
import { mockPrisma } from '../setup'

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

const mockAuth = vi.mocked(authenticateAPI)

const authedAs = (id: string, email: string) => ({
  userId: id,
  source: 'session' as const,
  scopes: ['*'],
  isAIAgent: false,
  user: { id, email, name: null, isAIAgent: false },
})

// Mock NextRequest
const createMockRequest = (listId: string) => {
  const request = new NextRequest(`http://localhost:3000/api/v1/lists/${listId}`)
  return request
}

/**
 * v1 decides access inside the query (owner, member, or PUBLIC). Answer that
 * findFirst from the fixture so the route's own where clause is what grants or
 * denies — not a canned null.
 */
function serveList(list: any) {
  mockPrisma.taskList.findFirst.mockImplementation(async ({ where }: any) => {
    if (!list || where.id !== list.id) return null
    const visible = where.OR.some((clause: any) =>
      (clause.ownerId !== undefined && clause.ownerId === list.ownerId) ||
      (clause.privacy !== undefined && clause.privacy === list.privacy) ||
      (clause.listMembers && (list.listMembers ?? []).some((m: any) => m.userId === clause.listMembers.some.userId)))
    return visible ? { _count: { tasks: list.tasks?.length ?? 0 }, ...list } : null
  })
}

describe('List Unique URL API (/api/v1/lists/[id])', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return list data for authorized user', async () => {
    const listId = 'test-list-id'
    const mockList = {
      id: listId,
      name: 'Test List',
      description: 'Test description',
      privacy: 'PRIVATE',
      ownerId: 'test-user-id',
      owner: {
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
      },
      admins: [],
      members: [],
      defaultAssignee: null,
      tasks: [
        {
          id: 'task-1',
          title: 'Test Task',
          assignee: { id: 'test-user-id', name: 'Test User' },
          creator: { id: 'test-user-id', name: 'Test User' },
        }
      ],
    }

    serveList(mockList)
    mockAuth.mockResolvedValue(authedAs('test-user-id', 'test@example.com'))

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    // v1 answers `{ list }` in its own wire shape rather than the raw row.
    expect(data.list).toMatchObject({ id: listId, name: 'Test List', ownerId: 'test-user-id', privacy: 'PRIVATE' })
    // v1 reads owner and members with the list but no longer embeds its tasks (legacy included `tasks`).
    expect(mockPrisma.taskList.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: listId }),
      include: expect.objectContaining({
        owner: expect.any(Object),
        listMembers: expect.any(Object),
      }),
    })
  })

  it('should return 404 for non-existent list', async () => {
    const listId = 'non-existent-list'
    
    serveList(null)
    mockAuth.mockResolvedValue(authedAs('test-user-id', 'test@example.com'))

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('List not found')
  })

  it('should refuse an unauthorized user trying to access private list', async () => {
    const listId = 'private-list-id'
    const mockList = {
      id: listId,
      name: 'Private List',
      privacy: 'PRIVATE',
      ownerId: 'other-user-id',
      owner: {
        id: 'other-user-id',
        name: 'Other User',
        email: 'other@example.com',
      },
      admins: [],
      members: [],
      defaultAssignee: null,
      tasks: [],
    }

    serveList(mockList)
    mockAuth.mockResolvedValue(authedAs('test-user-id', 'test@example.com'))

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    // Legacy answered 403 "Forbidden"; v1 filters access in the query and answers 404.
    expect(response.status).toBe(404)
    expect(data.error).toBe('List not found')
  })

  it('should allow access to public list for any authenticated user', async () => {
    const listId = 'public-list-id'
    const mockList = {
      id: listId,
      name: 'Public List',
      privacy: 'PUBLIC',
      ownerId: 'other-user-id',
      owner: {
        id: 'other-user-id',
        name: 'Other User',
        email: 'other@example.com',
      },
      admins: [],
      members: [],
      defaultAssignee: null,
      tasks: [],
    }

    serveList(mockList)
    mockAuth.mockResolvedValue(authedAs('test-user-id', 'test@example.com'))

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.list).toMatchObject({ id: listId, name: mockList.name })
  })

  it('should allow access for list members', async () => {
    const listId = 'shared-list-id'
    const mockList = {
      id: listId,
      name: 'Shared List',
      privacy: 'PRIVATE',
      ownerId: 'other-user-id',
      owner: {
        id: 'other-user-id',
        name: 'Other User',
        email: 'other@example.com',
      },
      listMembers: [
        {
          userId: 'test-user-id',
          role: 'member',
          user: {
            id: 'test-user-id',
            name: 'Test User',
            email: 'test@example.com',
          }
        }
      ],
      defaultAssignee: null,
      tasks: [],
    }

    serveList(mockList)
    mockAuth.mockResolvedValue(authedAs('test-user-id', 'test@example.com'))

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.list).toMatchObject({ id: listId, name: mockList.name })
  })

  it('should allow access for list admins', async () => {
    const listId = 'admin-list-id'
    const mockList = {
      id: listId,
      name: 'Admin List',
      privacy: 'PRIVATE',
      ownerId: 'other-user-id',
      owner: {
        id: 'other-user-id',
        name: 'Other User',
        email: 'other@example.com',
      },
      listMembers: [
        {
          userId: 'test-user-id',
          role: 'admin',
          user: {
            id: 'test-user-id',
            name: 'Test User',
            email: 'test@example.com',
          }
        }
      ],
      defaultAssignee: null,
      tasks: [],
    }

    serveList(mockList)
    mockAuth.mockResolvedValue(authedAs('test-user-id', 'test@example.com'))

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.list).toMatchObject({ id: listId, name: mockList.name })
  })

  it('should return 401 for unauthenticated user', async () => {
    const listId = 'test-list-id'
    
    mockAuth.mockRejectedValue(new UnauthorizedError())

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })
})