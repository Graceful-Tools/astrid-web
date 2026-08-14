import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET } from '@/app/api/users/search/route'
import { mockPrisma, mockGetServerSession } from '../setup'

// Mock NextRequest with URL search params
const createMockRequest = (searchParams: Record<string, string> = {}, headers: Record<string, string> = {}) => {
  const url = new URL('http://localhost:3000/api/users/search')
  Object.entries(searchParams).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })

  const request = {
    url: url.toString(),
    headers: {
      get: (name: string) => headers[name.toLowerCase()] || null
    }
  } as any as Request
  return request
}

describe('Users Search API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Reset all prisma mocks completely
    Object.values(mockPrisma.user).forEach((mock: any) => mock.mockReset())
    Object.values(mockPrisma.task).forEach((mock: any) => mock.mockReset())
    Object.values(mockPrisma.taskList).forEach((mock: any) => mock.mockReset())
    
    // Mock current user exists in database
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: 'test-image-url',
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: null
    })
    
    // taskList.findMany now serves TWO different queries in this route:
    //   1. the ASTRID-enabled-lists lookup (wants [] here, as before)
    //   2. the search-scope visibility filter added in task e0613ae5, which
    //      narrows the requested listIds to ones the CALLER belongs to
    // Discriminate on the where-shape rather than returning [] for both, or
    // every list-member test silently exercises "caller belongs to nothing".
    // Access control itself is covered in tests/api/user-search-scope-leak.test.ts.
    mockPrisma.taskList.findMany.mockImplementation(async (args: any) => {
      const requested = args?.where?.id?.in
      return requested ? requested.map((id: string) => ({ id })) : []
    })
    mockPrisma.task.findFirst.mockImplementation((...args: any[]) =>
      (mockPrisma.task.findUnique as any)(...args))
  })

  describe('Authentication', () => {
    it('should return 401 for unauthenticated user', async () => {
      mockGetServerSession.mockResolvedValueOnce(null)

      const request = createMockRequest({ q: 'search' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('Basic user search', () => {
    it('should return empty array for queries less than 2 characters without task/list context', async () => {
      const request = createMockRequest({ q: 'a' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.users).toEqual([])
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
    })

    it('should only return current user for search query without list context', async () => {
      // Without task/list context, we should only get the current user
      // (no general user search anymore - restricted to list members only)
      const request = createMockRequest({ q: 'jo' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.users).toHaveLength(1) // Only current user
      expect(data.users[0].id).toBe('test-user-id')
    })

    it('should include current user in search results', async () => {
      const request = createMockRequest({ q: 'user' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.users.some((user: any) => user.id === 'test-user-id')).toBe(true)
    })
  })

  describe('Task-based user search', () => {
    it('should return list members even with empty query when taskId is provided', async () => {
      const mockTask = {
        id: 'task-1',
        lists: [{ id: 'list-1' }, { id: 'list-2' }]
      }

      const mockListMembers = [
        {
          id: 'member-1',
          name: 'List Member One',
          email: 'member1@example.com',
          image: null
        },
        {
          id: 'member-2',
          name: 'List Member Two', 
          email: 'member2@example.com',
          image: 'member2.jpg'
        }
      ]

      mockPrisma.task.findUnique.mockResolvedValue(mockTask)
      mockPrisma.user.findMany
        .mockResolvedValueOnce(mockListMembers) // List members query
        .mockResolvedValueOnce([]) // AI agents query (none are list members)

      const request = createMockRequest({ taskId: 'task-1', q: '' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.users).toHaveLength(3) // 2 list members + current user

      // Check that list members are properly marked
      const listMembersResult = data.users.filter((u: any) => u.isListMember)
      const currentUser = data.users.find((u: any) => u.id === 'test-user-id')
      expect(listMembersResult).toHaveLength(2)
      expect(currentUser).toBeDefined()
      expect(data.listMemberCount).toBe(2)

      // Verify the task lookup is SCOPED TO THE CALLER.
      //
      // This used to assert a bare `findUnique({ where: { id: 'task-1' } })`.
      // That unscoped lookup was the bug fixed in task e0613ae5: any caller
      // could name any task id and get its lists' members — including their
      // email addresses. The lookup now carries an access clause, and this
      // assertion exists to stop it quietly reverting to a bare id lookup.
      const taskLookup = (mockPrisma.task.findFirst as any).mock.calls[0][0]
      expect(taskLookup.where.id).toBe('task-1')
      expect(JSON.stringify(taskLookup.where.OR)).toContain('test-user-id')

      // Verify list members query - no AND wrapper when no query string
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { ownedLists: { some: { id: { in: ['list-1', 'list-2'] } } } },
            { listMemberships: { some: { listId: { in: ['list-1', 'list-2'] } } } }
          ]
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true
        },
        take: 10
      })
    })

    it('should handle non-existent task gracefully', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(null)
      mockPrisma.user.findMany.mockResolvedValue([])

      const request = createMockRequest({ taskId: 'non-existent-task', q: '' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.users).toHaveLength(1) // Just the current user
      expect(data.users[0].id).toBe('test-user-id')
      expect(data.listMemberCount).toBe(0)
    })

    it('should search within list members when query is provided', async () => {
      const mockTask = {
        id: 'task-1',
        lists: [{ id: 'list-1' }]
      }

      const mockListMembers = [
        {
          id: 'member-1',
          name: 'Alice Johnson',
          email: 'alice@example.com',
          image: null
        }
      ]

      mockPrisma.task.findUnique.mockResolvedValue(mockTask)
      mockPrisma.user.findMany
        .mockResolvedValueOnce(mockListMembers) // List members query with filter
        .mockResolvedValueOnce([]) // AI agents query

      const request = createMockRequest({ taskId: 'task-1', q: 'alice' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      // Only list member + current user (no general user search anymore)
      expect(data.users).toHaveLength(2)

      // Find the list member
      const listMember = data.users.find((u: any) => u.name === 'Alice Johnson')
      const currentUser = data.users.find((u: any) => u.id === 'test-user-id')

      expect(listMember).toBeDefined()
      expect(listMember.isListMember).toBe(true)
      expect(currentUser).toBeDefined()

      // Verify list members query includes search filter
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                OR: [
                  { ownedLists: { some: { id: { in: ['list-1'] } } } },
                  { listMemberships: { some: { listId: { in: ['list-1'] } } } }
                ]
              },
              {
                OR: [
                  { name: { contains: 'alice', mode: 'insensitive' } },
                  { email: { contains: 'alice', mode: 'insensitive' } }
                ]
              }
            ]
          }
        })
      )
    })
  })

  describe('List-based user search', () => {
    it('should return list members when listIds are provided', async () => {
      const mockListMembers = [
        {
          id: 'owner-1',
          name: 'List Owner',
          email: 'owner@example.com',
          image: null
        }
      ]

      mockPrisma.user.findMany
        .mockResolvedValueOnce(mockListMembers) // List members query
        .mockResolvedValueOnce([]) // AI agents query

      const request = createMockRequest({ listIds: 'list-1,list-2', q: '' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.users).toHaveLength(2) // list member + current user

      const listMember = data.users.find((u: any) => u.id === 'owner-1')
      const currentUser = data.users.find((u: any) => u.id === 'test-user-id')

      expect(listMember).toBeDefined()
      expect(listMember.isListMember).toBe(true)
      expect(currentUser).toBeDefined()
      expect(data.listMemberCount).toBe(1)

      // Verify list members query - no AND wrapper when no query string
      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { ownedLists: { some: { id: { in: ['list-1', 'list-2'] } } } },
            { listMemberships: { some: { listId: { in: ['list-1', 'list-2'] } } } }
          ]
        },
        select: {
          id: true,
          name: true,
          email: true,
          image: true
        },
        take: 10
      })
    })

    it('should handle empty listIds gracefully', async () => {
      const request = createMockRequest({ listIds: '', q: 'search' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.users).toHaveLength(1) // Just current user
      expect(data.users[0].id).toBe('test-user-id')
    })
  })

  describe('Deduplication and limits', () => {
    it('should deduplicate list members', async () => {
      const mockListMembers = [
        {
          id: 'member-1',
          name: 'List Member',
          email: 'member@example.com',
          image: null
        },
        {
          id: 'member-1', // Duplicate - should be filtered out
          name: 'List Member',
          email: 'member@example.com',
          image: null
        }
      ]

      mockPrisma.user.findMany
        .mockResolvedValueOnce(mockListMembers) // List members query
        .mockResolvedValueOnce([]) // AI agents query

      const request = createMockRequest({ listIds: 'list-1', q: '' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      // Only unique list member + current user (deduplicated)
      expect(data.users).toHaveLength(2)

      const listMember = data.users.find((u: any) => u.id === 'member-1')
      const currentUser = data.users.find((u: any) => u.id === 'test-user-id')

      expect(listMember).toBeDefined()
      expect(listMember.isListMember).toBe(true)
      expect(currentUser).toBeDefined()
    })

    it('should limit results to 10 users', async () => {
      const mockListMembers = Array.from({ length: 15 }, (_, i) => ({
        id: `member-${i}`,
        name: `Member ${i}`,
        email: `member${i}@example.com`,
        image: null
      }))

      mockPrisma.user.findMany
        .mockResolvedValueOnce(mockListMembers) // List members query returns 15 users
        .mockResolvedValueOnce([]) // AI agents query

      const request = createMockRequest({ listIds: 'list-1', q: '' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.users).toHaveLength(10) // Limited to 10
    })
  })

  describe('Error handling', () => {
    it('should handle database errors gracefully for list members query', async () => {
      const mockTask = {
        id: 'task-1',
        lists: [{ id: 'list-1' }]
      }

      mockPrisma.task.findUnique.mockResolvedValue(mockTask)
      mockPrisma.user.findMany
        .mockRejectedValueOnce(new Error('Database error')) // List members query fails
        .mockResolvedValueOnce([]) // AI agents query succeeds

      const request = createMockRequest({ taskId: 'task-1', q: 'search' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.users).toHaveLength(1) // Just current user
      expect(data.users[0].id).toBe('test-user-id')
      expect(data.listMemberCount).toBe(0)
    })

    it('should handle general database errors', async () => {
      // When findUnique fails for current user, it causes an internal error
      mockPrisma.user.findUnique.mockRejectedValue(new Error('Database error'))

      const request = createMockRequest({ q: 'search' })
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })

    it('should handle invalid listIds format', async () => {
      // When list IDs are provided (even if invalid UUIDs), the code queries for list members
      mockPrisma.user.findMany
        .mockResolvedValueOnce([]) // List members query (no results for invalid IDs)
        .mockResolvedValueOnce([]) // AI agents query (no results for invalid IDs)

      const request = createMockRequest({ listIds: 'invalid,,format,', q: 'search' })
      const response = await GET(request)

      expect(response.status).toBe(200)
      // Should still work, just filtering out empty values and returning only current user
    })
  })
})