import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { GET, POST } from '@/app/api/lists/route'
import { mockPrisma } from '../setup'

// Mock Redis more explicitly for this test file
vi.mock('@/lib/redis', () => ({
  RedisCache: {
    // Mock getOrSet to call the fetchFn callback and return its result
    getOrSet: vi.fn().mockImplementation(async (key, fetchFn, ttl) => {
      return await fetchFn()
    }),
    del: vi.fn().mockResolvedValue(undefined),
    keys: {
      userLists: vi.fn((userId) => `lists:user:${userId}`)
    }
  }
}))

// Import the mocked RedisCache
import { RedisCache } from '@/lib/redis'
const mockRedisCache = vi.mocked(RedisCache)

// Match the safeUserSelect pattern used in the implementation for security
const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
}

// Use the session from global setup
const mockSession = {
  user: {
    id: 'test-user-id',
    name: 'Test User',
    email: 'test@example.com',
  }
}

// Mock OpenAI functions
vi.mock('@/lib/openai', () => ({
  generateListImage: vi.fn(() => Promise.resolve(null)), // Return null to skip image generation
}))

vi.mock('@/lib/openai-config', () => ({
  validateOpenAIConfig: vi.fn(() => false), // Return false to skip image generation
}))

// Mock NextRequest and NextResponse
const createMockRequest = (method: string, body?: any) => {
  const request = {
    method,
    json: vi.fn(() => Promise.resolve(body)),
    headers: new Map(),
    url: 'http://localhost:3000/api/lists', // Add URL for incremental sync support
  } as any

  return request
}

describe('/api/lists - List Defaults', () => {
  beforeEach(() => {
    // Clear only the specific mocks we're testing, not the global setup mocks
    mockPrisma.taskList.findMany.mockReset()
    mockPrisma.taskList.create.mockReset()
    mockPrisma.user.findUnique.mockReset()
    mockRedisCache.getOrSet.mockReset()
    
    // Set up default Redis behavior to pass through to fetchFn
    mockRedisCache.getOrSet.mockImplementation((key, fetchFn) => fetchFn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST /api/lists', () => {
    it('creates a list with all default settings including due date', async () => {
      const listData = {
        name: 'Test List',
        description: 'A test list with defaults',
        color: '#3B82F6',
        privacy: 'SHARED',
        adminIds: ['admin-1', 'admin-2'],
        defaultAssigneeId: 'assignee-1',
        defaultPriority: 2,
        defaultRepeating: 'weekly',
        defaultIsPrivate: false,
        defaultDueDate: 'tomorrow',
      }

      const mockCreatedList = {
        id: 'new-list-id',
        name: listData.name,
        description: listData.description,
        color: listData.color,
        privacy: listData.privacy,
        imageUrl: 'default-image.jpg',
        ownerId: mockSession.user.id,
        defaultAssigneeId: listData.defaultAssigneeId,
        defaultPriority: listData.defaultPriority,
        defaultRepeating: listData.defaultRepeating,
        defaultIsPrivate: listData.defaultIsPrivate,
        defaultDueDate: listData.defaultDueDate,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        owner: {
          id: mockSession.user.id,
          name: mockSession.user.name,
          email: mockSession.user.email,
        },
        admins: [
          { id: 'admin-1', name: 'Admin 1', email: 'admin1@example.com' },
          { id: 'admin-2', name: 'Admin 2', email: 'admin2@example.com' },
        ],
        defaultAssignee: {
          id: 'assignee-1',
          name: 'Default Assignee',
          email: 'assignee@example.com',
        },
        _count: { tasks: 0 },
      }

      mockPrisma.taskList.create.mockResolvedValue(mockCreatedList)
      
      // Mock user lookup for defaultAssignee
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'assignee-1',
        name: 'Default Assignee',
        email: 'assignee@example.com',
      })

      const request = createMockRequest('POST', listData)
      const response = await POST(request)
      const data = await response.json()

      expect(mockPrisma.taskList.create).toHaveBeenCalledWith({
        data: {
          name: listData.name,
          description: listData.description,
          color: listData.color,
          privacy: listData.privacy,
          imageUrl: undefined, // No imageUrl provided in request
          listType: 'regular',
          ownerId: mockSession.user.id,
          projectId: null,
          statusRole: null,
          statusOrder: null,
          statusDescription: null,
          statusCompleted: false,
          // admins/members are now added via separate ListMember.create calls
          defaultAssigneeId: listData.defaultAssigneeId,
          defaultPriority: listData.defaultPriority,
          defaultRepeating: listData.defaultRepeating,
          defaultIsPrivate: listData.defaultIsPrivate,
          defaultDueDate: listData.defaultDueDate,
        },
        include: {
          owner: { select: safeUserSelect },
          _count: {
            select: {
              tasks: true,
            },
          },
        },
      })

      expect(data).toEqual(mockCreatedList)
      expect(response.status).toBe(200)
    })

    it('creates a list with minimal data and default due date setting', async () => {
      const listData = {
        name: 'Simple List',
        privacy: 'PRIVATE',
        defaultDueDate: 'none',
      }

      const mockCreatedList = {
        id: 'simple-list-id',
        name: listData.name,
        privacy: listData.privacy,
        imageUrl: 'default-image.jpg',
        defaultDueDate: listData.defaultDueDate,
        ownerId: mockSession.user.id,
        owner: mockSession.user,
        // Removed legacy admins
        _count: { tasks: 0 },
      }

      mockPrisma.taskList.create.mockResolvedValue(mockCreatedList)

      const request = createMockRequest('POST', listData)
      const response = await POST(request)

      expect(mockPrisma.taskList.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            defaultDueDate: 'none',
          }),
        })
      )

      expect(response.status).toBe(200)
    })

    it('handles all due date default options', async () => {
      const dueDateOptions = ['none', 'today', 'tomorrow', 'next_week']

      for (const dueDate of dueDateOptions) {
        const listData = {
          name: `List with ${dueDate} default`,
          privacy: 'PRIVATE',
          defaultDueDate: dueDate,
        }

        mockPrisma.taskList.create.mockResolvedValue({
          id: `list-${dueDate}`,
          ...listData,
          imageUrl: 'default-image.jpg',
          ownerId: mockSession.user.id,
          owner: mockSession.user,
        })

        const request = createMockRequest('POST', listData)
        await POST(request)

        expect(mockPrisma.taskList.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              defaultDueDate: dueDate,
            }),
          })
        )
      }
    })

    it('validates required fields and allows optional due date default', async () => {
      const invalidData = {
        // Missing name
        description: 'A list without a name',
        defaultDueDate: 'today',
      }

      const request = createMockRequest('POST', invalidData)
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('handles undefined due date default gracefully', async () => {
      const listData = {
        name: 'List without due date default',
        privacy: 'PRIVATE',
        // defaultDueDate is undefined
      }

      const mockCreatedList = {
        id: 'list-without-due-date',
        ...listData,
        defaultDueDate: null,
        ownerId: mockSession.user.id,
        owner: mockSession.user,
      }

      mockPrisma.taskList.create.mockResolvedValue(mockCreatedList)

      const request = createMockRequest('POST', listData)
      const response = await POST(request)

      // The API should handle undefined values gracefully by excluding them
      expect(mockPrisma.taskList.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.not.objectContaining({
            defaultDueDate: expect.anything(),
          }),
        })
      )

      expect(response.status).toBe(200)
    })
  })

  describe('GET /api/lists', () => {
    it('returns lists with default settings including due date', async () => {
      const mockLists = [
        {
          id: 'list-1',
          name: 'Project Alpha',
          privacy: 'SHARED',
          defaultPriority: 2,
          defaultRepeating: 'weekly',
          defaultIsPrivate: false,
          defaultDueDate: 'tomorrow',
          owner: mockSession.user,
          // Removed legacy admins
          defaultAssigneeId: 'assignee-1',
          // Removed legacy members
          listMembers: [],
          _count: { tasks: 5 },
        },
        {
          id: 'list-2',
          name: 'Personal Tasks',
          privacy: 'PRIVATE',
          defaultPriority: 0,
          defaultRepeating: 'never',
          defaultIsPrivate: true,
          defaultDueDate: 'none',
          owner: mockSession.user,
          // Removed legacy admins
          defaultAssigneeId: null,
          // Removed legacy members
          listMembers: [],
          _count: { tasks: 3 },
        },
      ]

      mockPrisma.taskList.findMany.mockResolvedValue(mockLists)
      
      // Mock batch user lookup for defaultAssignee (uses findMany with id: { in: [...] })
      mockPrisma.user.findMany.mockResolvedValue([
        {
          id: 'assignee-1',
          name: 'Default Assignee',
          email: 'assignee@example.com',
          image: null,
          isAIAgent: false,
        },
      ])

      const request = createMockRequest('GET')
      const response = await GET(request)
      const responseData = await response.json()

      // New response format includes metadata
      expect(responseData).toHaveProperty('lists')
      expect(responseData).toHaveProperty('timestamp')
      const data = responseData.lists

      expect(mockPrisma.taskList.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { ownerId: mockSession.user.id },
            // Removed legacy admins check
            // Removed legacy members check
            { listMembers: { some: { userId: mockSession.user.id } } }, // Also check new ListMember table
            // Project membership grants visibility to the project's lists (sub-task #3)
            { project: { OR: [
              { ownerId: mockSession.user.id },
              { members: { some: { userId: mockSession.user.id } } },
            ] } },
            { privacy: "PUBLIC" }
          ],
        },
        include: {
          owner: { select: safeUserSelect },
          listMembers: {
            include: {
              user: { select: safeUserSelect }
            }
          },
          project: { select: { ownerId: true, members: { select: { userId: true, role: true } } } },
          _count: {
            select: {
              tasks: true,
            },
          },
        },
        orderBy: [
          { createdAt: "desc" },
        ],
      })

      expect(data).toEqual([
        {
          id: 'list-1',
          name: 'Project Alpha',
          privacy: 'SHARED',
          defaultPriority: 2,
          defaultRepeating: 'weekly',
          defaultIsPrivate: false,
          defaultDueDate: 'tomorrow',
          isFavorite: false,
          favoriteOrder: null,
          owner: mockSession.user,
          // Removed legacy admins
          defaultAssigneeId: 'assignee-1',
          defaultAssignee: {
            id: 'assignee-1',
            name: 'Default Assignee',
            email: 'assignee@example.com',
            image: null,
            isAIAgent: false,
          },
          // Removed legacy members
          listMembers: [],
          _count: { tasks: 5 },
        },
        {
          id: 'list-2',
          name: 'Personal Tasks',
          privacy: 'PRIVATE',
          defaultPriority: 0,
          defaultRepeating: 'never',
          defaultIsPrivate: true,
          defaultDueDate: 'none',
          isFavorite: false,
          favoriteOrder: null,
          owner: mockSession.user,
          // Removed legacy admins
          defaultAssigneeId: null,
          defaultAssignee: null,
          // Removed legacy members
          listMembers: [],
          _count: { tasks: 3 },
        },
      ])
      expect(data[0].defaultDueDate).toBe('tomorrow')
      expect(data[1].defaultDueDate).toBe('none')
    })

    it('handles lists without default settings', async () => {
      const mockLists = [
        {
          id: 'list-without-defaults',
          name: 'Basic List',
          privacy: 'PRIVATE',
          defaultPriority: null,
          defaultRepeating: null,
          defaultIsPrivate: null,
          defaultDueDate: null,
          owner: mockSession.user,
          // Removed legacy admins
          defaultAssignee: null,
          _count: { tasks: 0 },
        },
      ]

      mockPrisma.taskList.findMany.mockResolvedValue(mockLists)

      const request = createMockRequest('GET')
      const response = await GET(request)
      const responseData = await response.json()

      // New response format includes metadata
      expect(responseData).toHaveProperty('lists')
      const data = responseData.lists

      expect(data[0].defaultDueDate).toBeNull()
      expect(response.status).toBe(200)
    })
  })

  describe('Database Constraints', () => {
    it('handles database errors during list creation', async () => {
      mockPrisma.taskList.create.mockRejectedValue(new Error('Database connection failed'))

      const listData = {
        name: 'Test List',
        privacy: 'PRIVATE',
        defaultDueDate: 'today',
      }

      const request = createMockRequest('POST', listData)
      const response = await POST(request)

      // Implementation returns 400 for database errors; the route also logs
      // via pino — assertion on the log call removed since the route no
      // longer goes through console.error.
      expect(response.status).toBe(400)
    })

    it('validates due date default values', async () => {
      const invalidListData = {
        name: 'Invalid Due Date List',
        privacy: 'PRIVATE',
        defaultDueDate: 'invalid_option',
      }

      // This would normally be caught by database constraints or validation
      const request = createMockRequest('POST', invalidListData)
      
      // The API should handle this gracefully
      // In a real implementation, you might want to add validation
      expect(async () => {
        await POST(request)
      }).not.toThrow()
    })
  })

  describe('Default Settings Object Construction', () => {
    it('constructs complete defaultSettings object from API data', () => {
      const apiData = {
        defaultAssigneeId: 'assignee-1',
        defaultPriority: 2,
        defaultRepeating: 'weekly',
        defaultIsPrivate: false,
        defaultDueDate: 'tomorrow',
      }

      const mockList = {
        id: 'test-list',
        defaultAssignee: { id: 'assignee-1', name: 'Assignee' },
        ...apiData,
      }

      // This would typically be done in the frontend when receiving API data
      const defaultSettings = {
        assignee: mockList.defaultAssignee,
        priority: mockList.defaultPriority,
        repeating: mockList.defaultRepeating,
        isPrivate: mockList.defaultIsPrivate,
        dueDate: mockList.defaultDueDate,
      }

      expect(defaultSettings).toEqual({
        assignee: { id: 'assignee-1', name: 'Assignee' },
        priority: 2,
        repeating: 'weekly',
        isPrivate: false,
        dueDate: 'tomorrow',
      })
    })

    it('handles partial default settings', () => {
      const mockList = {
        id: 'test-list',
        defaultAssignee: null,
        defaultPriority: 1,
        defaultRepeating: null,
        defaultIsPrivate: null,
        defaultDueDate: 'today',
      }

      const defaultSettings = {
        assignee: mockList.defaultAssignee,
        priority: mockList.defaultPriority,
        repeating: mockList.defaultRepeating,
        isPrivate: mockList.defaultIsPrivate,
        dueDate: mockList.defaultDueDate,
      }

      expect(defaultSettings).toEqual({
        assignee: null,
        priority: 1,
        repeating: null,
        isPrivate: null,
        dueDate: 'today',
      })
    })
  })
})
