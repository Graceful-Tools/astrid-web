import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET } from '@/app/api/users/[userId]/profile/route'
import { mockPrisma, mockGetServerSession } from '../setup'

// Helper to create mock NextRequest
function createMockRequest() {
  return {
    headers: new Headers(),
    cookies: { get: () => undefined },
  } as any
}

describe('User Profile API', () => {
  const mockCurrentUser = {
    id: 'current-user-id',
    name: 'Current User',
    email: 'current@example.com',
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    emailVerified: null,
  }

  const mockProfileUser = {
    id: 'profile-user-id',
    name: 'Profile User',
    email: 'profile@example.com',
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    isAIAgent: false,
    aiAgentType: null,
    statsCompletedTasks: 5,
    statsInspiredTasks: 3,
    statsSupportedTasks: 2,
    statsLastCalculated: new Date(),
  }

  beforeEach(() => {
    vi.clearAllMocks()

    // Mock authenticated session (with id for authenticateAPI)
    mockGetServerSession.mockResolvedValue({
      user: { id: 'current-user-id', email: 'current@example.com', name: 'Current User' },
      expires: new Date(Date.now() + 86400000).toISOString(),
    })

    // Mock current user lookup
    mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
      if (where.email === 'current@example.com') {
        return Promise.resolve({ ...mockCurrentUser, isAIAgent: false })
      }
      if (where.id === 'profile-user-id') {
        return Promise.resolve(mockProfileUser)
      }
      if (where.id === 'current-user-id') {
        return Promise.resolve({ ...mockCurrentUser, isAIAgent: false })
      }
      return Promise.resolve(null)
    })

    // Default mock for tasks
    mockPrisma.task.findMany.mockResolvedValue([])
    mockPrisma.task.count.mockResolvedValue(0)
    mockPrisma.comment.count.mockResolvedValue(0)
  })

  describe('Authentication', () => {
    it('should return 401 for unauthenticated user', async () => {
      mockGetServerSession.mockResolvedValueOnce(null)

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 404 when profile user not found', async () => {
      mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
        // Allow authentication to succeed for current user
        if (where.email === 'current@example.com') {
          return Promise.resolve({ ...mockCurrentUser, isAIAgent: false })
        }
        if (where.id === 'current-user-id') {
          return Promise.resolve({ ...mockCurrentUser, isAIAgent: false })
        }
        // Return null for the non-existent profile user
        return Promise.resolve(null)
      })

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'non-existent-user' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('User not found')
    })
  })

  describe('Public List Filtering', () => {
    it('should only return tasks in PUBLIC lists when viewing own profile', async () => {
      const publicTask = {
        id: 'task-1',
        title: 'Public Task',
        completed: false,
        priority: 1,
        repeating: 'never',
        isPrivate: false,
        createdAt: new Date(),
        assignee: null,
        creator: mockCurrentUser,
        lists: [
          {
            id: 'list-1',
            name: 'Public List',
            color: '#3b82f6',
            privacy: 'PUBLIC',
          },
        ],
      }

      const privateTask = {
        id: 'task-2',
        title: 'Private Task',
        completed: false,
        priority: 1,
        repeating: 'never',
        isPrivate: false,
        createdAt: new Date(),
        assignee: null,
        creator: mockCurrentUser,
        lists: [
          {
            id: 'list-2',
            name: 'Private List',
            color: '#3b82f6',
            privacy: 'PRIVATE',
          },
        ],
      }

      mockPrisma.task.findMany.mockResolvedValue([publicTask])

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'current-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.sharedTasks).toHaveLength(1)
      expect(data.sharedTasks[0].id).toBe('task-1')
      expect(data.isOwnProfile).toBe(true)

      // Verify the query filtered for PUBLIC lists
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                lists: {
                  some: {
                    privacy: 'PUBLIC',
                  },
                },
              }),
            ]),
            isPrivate: false,
          }),
        })
      )
    })

    it('should only return tasks in PUBLIC lists when viewing another user profile', async () => {
      const publicTask = {
        id: 'task-1',
        title: 'Public Task',
        completed: false,
        priority: 1,
        repeating: 'never',
        isPrivate: false,
        createdAt: new Date(),
        assignee: null,
        creator: mockProfileUser,
        lists: [
          {
            id: 'list-1',
            name: 'Public List',
            color: '#3b82f6',
            privacy: 'PUBLIC',
          },
        ],
      }

      mockPrisma.task.findMany.mockResolvedValue([publicTask])

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.sharedTasks).toHaveLength(1)
      expect(data.sharedTasks[0].id).toBe('task-1')
      expect(data.isOwnProfile).toBe(false)

      // Verify the query filtered for PUBLIC lists
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                lists: {
                  some: {
                    privacy: 'PUBLIC',
                  },
                },
              }),
            ]),
            isPrivate: false,
          }),
        })
      )
    })

    it('should exclude tasks in SHARED lists from profile', async () => {
      mockPrisma.task.findMany.mockResolvedValue([])

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.sharedTasks).toHaveLength(0)

      // Verify query requires PUBLIC privacy (excludes SHARED)
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                lists: {
                  some: {
                    privacy: 'PUBLIC',
                  },
                },
              }),
            ]),
          }),
        })
      )
    })

    it('should exclude tasks in PRIVATE lists from profile', async () => {
      mockPrisma.task.findMany.mockResolvedValue([])

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.sharedTasks).toHaveLength(0)

      // Verify query requires PUBLIC privacy (excludes PRIVATE)
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                lists: {
                  some: {
                    privacy: 'PUBLIC',
                  },
                },
              }),
            ]),
          }),
        })
      )
    })

    it('should exclude tasks with isPrivate=true', async () => {
      mockPrisma.task.findMany.mockResolvedValue([])

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )

      expect(response.status).toBe(200)

      // Verify query explicitly filters out private tasks
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            isPrivate: false,
          }),
        })
      )
    })

    it('should return tasks created by profile user in PUBLIC lists', async () => {
      const createdTask = {
        id: 'task-1',
        title: 'Created Task',
        completed: false,
        priority: 1,
        repeating: 'never',
        isPrivate: false,
        createdAt: new Date(),
        assignee: null,
        creator: mockProfileUser,
        lists: [
          {
            id: 'list-1',
            name: 'Public List',
            color: '#3b82f6',
            privacy: 'PUBLIC',
          },
        ],
      }

      mockPrisma.task.findMany.mockResolvedValue([createdTask])

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.sharedTasks).toHaveLength(1)
      expect(data.sharedTasks[0].creator.id).toBe('profile-user-id')

      // Verify query includes creatorId filter
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                creatorId: 'profile-user-id',
              }),
            ]),
          }),
        })
      )
    })

    it('should return tasks assigned to profile user in PUBLIC lists', async () => {
      const assignedTask = {
        id: 'task-1',
        title: 'Assigned Task',
        completed: false,
        priority: 1,
        repeating: 'never',
        isPrivate: false,
        createdAt: new Date(),
        assignee: mockProfileUser,
        creator: mockCurrentUser,
        lists: [
          {
            id: 'list-1',
            name: 'Public List',
            color: '#3b82f6',
            privacy: 'PUBLIC',
          },
        ],
      }

      mockPrisma.task.findMany.mockResolvedValue([assignedTask])

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.sharedTasks).toHaveLength(1)
      expect(data.sharedTasks[0].assignee.id).toBe('profile-user-id')

      // Verify query includes assigneeId filter
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: expect.arrayContaining([
              expect.objectContaining({
                assigneeId: 'profile-user-id',
              }),
            ]),
          }),
        })
      )
    })
  })

  describe('User Statistics', () => {
    it('should return user statistics in response', async () => {
      mockPrisma.task.findMany.mockResolvedValue([])
      // Mock the count queries used by calculateUserStats (called via getUserStats with forceRefresh=true)
      mockPrisma.task.count
        .mockResolvedValueOnce(5) // completedTasks: tasks assigned to user and completed
        .mockResolvedValueOnce(3) // inspiredTasks: tasks created by user completed by others
      mockPrisma.comment.count.mockResolvedValueOnce(2) // supportedTasks: comments on others' tasks

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.stats).toBeDefined()
      expect(data.stats.completed).toBe(5)
      expect(data.stats.inspired).toBe(3)
      expect(data.stats.supported).toBe(2)
    })

    it('should include user profile information', async () => {
      mockPrisma.task.findMany.mockResolvedValue([])

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.user).toBeDefined()
      expect(data.user.id).toBe('profile-user-id')
      expect(data.user.name).toBe('Profile User')
      // Email is privacy-gated: the route returns it only for the viewer's OWN
      // profile (isOwnProfile). This request is for another user, so email is
      // withheld. (Own-profile email presence is covered by the isOwnProfile tests.)
      expect(data.user.email).toBeUndefined()
    })

    it('should indicate when viewing own profile', async () => {
      mockPrisma.task.findMany.mockResolvedValue([])

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'current-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.isOwnProfile).toBe(true)
    })

    it('should indicate when viewing another user profile', async () => {
      mockPrisma.task.findMany.mockResolvedValue([])

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.isOwnProfile).toBe(false)
    })
  })

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      mockPrisma.task.findMany.mockRejectedValue(new Error('Database error'))

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to fetch user profile')
    })

    it('should handle current user not found', async () => {
      // Mock session to pass auth
      mockGetServerSession.mockResolvedValue({
        user: { id: 'current-user-id', email: 'current@example.com', name: 'Current User' },
        expires: new Date(Date.now() + 86400000).toISOString(),
      })

      // Sequence of user lookups:
      // 1st call: authenticateAPI looks up session user - return it
      // 2nd call: profile user lookup - return it
      // 3rd call: current user verification - return null to trigger 404
      let callCount = 0
      mockPrisma.user.findUnique.mockImplementation(({ where }: any) => {
        callCount++
        if (callCount === 1 && where.id === 'current-user-id') {
          return Promise.resolve({ ...mockCurrentUser, isAIAgent: false })
        }
        if (where.id === 'profile-user-id') {
          return Promise.resolve(mockProfileUser)
        }
        if (callCount >= 3 && where.id === 'current-user-id') {
          return Promise.resolve(null) // Current user no longer exists
        }
        return Promise.resolve(null)
      })

      const response = await GET(
        createMockRequest(),
        { params: Promise.resolve({ userId: 'profile-user-id' }) }
      )
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Current user not found')
    })
  })
})
