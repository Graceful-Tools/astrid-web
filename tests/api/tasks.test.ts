import { describe, it, expect, beforeEach, vi } from 'vitest'
import { row, rows } from '../fixtures/prisma-rows'

import { mockPrisma, mockGetServerSession } from '../setup'

// Mock NextRequest
const createMockRequest = (data?: any) => {
  const request = {
    json: vi.fn().mockResolvedValue(data || {}),
    url: 'http://localhost:3000/api/tasks',
  } as any as Request
  return request
}

// Match the safeUserSelect pattern used in the implementation for security
const safeUserSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
}

// NextAuth session is already mocked in setup.ts

let GET: any, POST: any;

// Hoisted once, before anything in this file, so it cannot be "re-applied"
// inside beforeEach — it was never doing that (vitest 5 makes it an error,
// AWTD-1391). vi.resetModules() below still gives each test a fresh route
// module, which is what that block was actually relying on.
vi.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
}))

describe('Tasks API', () => {
  beforeEach(async () => {
    vi.resetModules()
    // Dynamically import the API routes
    const tasksRoute = await import('@/app/api/tasks/route');
    GET = tasksRoute.GET;
    POST = tasksRoute.POST;
    // PUT/DELETE /api/tasks/[id] were deleted once the census cleared them
    // (AWTD-839); their behaviour is covered by the v1-task* suites.

    vi.clearAllMocks()
    // Mock user exists in database
    mockPrisma.user.findUnique.mockResolvedValue(row({
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: 'test-image-url',
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: null
    }))
  })

  describe('GET /api/tasks', () => {
    it('should return tasks for authenticated user', async () => {
      const mockTasks = [
        {
          id: 'task-1',
          title: 'Test Task',
          description: 'Test Description',
          priority: 1,
          completed: false,
          assigneeId: 'test-user-id',
          creatorId: 'test-user-id',
          createdAt: '2025-08-16T18:36:23.687Z',
          updatedAt: '2025-08-16T18:36:23.687Z',
          assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
          creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
          lists: [],
          comments: []
        }
      ]

      mockPrisma.task.findMany.mockResolvedValue(mockTasks)

      const request = createMockRequest()
      const response = await GET(request)
      const responseData = await response.json()

      expect(response.status).toBe(200)
      // New response format includes metadata
      expect(responseData).toHaveProperty('tasks')
      expect(responseData).toHaveProperty('timestamp')
      expect(responseData.tasks).toEqual(mockTasks)
      expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
        where: {
          OR: [
            { assigneeId: 'test-user-id' },
            { creatorId: 'test-user-id' },
            {
              lists: {
                some: {
                  OR: [
                    { ownerId: 'test-user-id' },
                    { listMembers: { some: { userId: 'test-user-id' } } },
                  ],
                },
              },
            },
          ],
        },
        include: {
          assignee: { select: safeUserSelect },
          creator: { select: safeUserSelect },
          lists: {
            include: {
              owner: { select: safeUserSelect },
              listMembers: { include: { user: { select: safeUserSelect } } }
            }
          },
          // Comments are loaded on-demand in task detail view (performance optimization)
          _count: {
            select: { comments: true }
          },
          attachments: true,
        },
        orderBy: [
          { completed: "asc" },
          { priority: "desc" },
          { dueDateTime: "asc" },
        ],
      })
    })

    it('should return tasks sorted by completion status, priority, and due date', async () => {
      const mockTasks = [
        {
          id: 'task-E',
          title: 'Task E',
          completed: false,
          priority: 3,
          dueDateTime: new Date('2025-01-15T10:00:00Z'),
          assigneeId: 'test-user-id',
          creatorId: 'test-user-id',
          createdAt: new Date('2024-01-05T10:00:00Z'),
          updatedAt: new Date('2024-01-05T10:00:00Z'),
          assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false },
          creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false },
          lists: [],
          _count: { comments: 0 },
          attachments: [],
        },
        {
          id: 'task-B',
          title: 'Task B',
          completed: false,
          priority: 2,
          dueDateTime: new Date('2025-03-01T10:00:00Z'),
          assigneeId: 'test-user-id',
          creatorId: 'test-user-id',
          createdAt: new Date('2024-01-02T10:00:00Z'),
          updatedAt: new Date('2024-01-02T10:00:00Z'),
          assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false },
          creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false },
          lists: [],
          _count: { comments: 0 },
          attachments: [],
        },
        {
          id: 'task-C',
          title: 'Task C',
          completed: false,
          priority: 1,
          dueDateTime: new Date('2025-02-01T10:00:00Z'),
          assigneeId: 'test-user-id',
          creatorId: 'test-user-id',
          createdAt: new Date('2024-01-03T10:00:00Z'),
          updatedAt: new Date('2024-01-03T10:00:00Z'),
          assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false },
          creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false },
          lists: [],
          _count: { comments: 0 },
          attachments: [],
        },
        {
          id: 'task-A',
          title: 'Task A',
          completed: true,
          priority: 1,
          dueDateTime: new Date('2025-01-01T10:00:00Z'),
          assigneeId: 'test-user-id',
          creatorId: 'test-user-id',
          createdAt: new Date('2024-01-01T10:00:00Z'),
          updatedAt: new Date('2024-01-01T10:00:00Z'),
          assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false },
          creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false },
          lists: [],
          _count: { comments: 0 },
          attachments: [],
        },
        {
          id: 'task-D',
          title: 'Task D',
          completed: true,
          priority: 2,
          dueDateTime: new Date('2025-04-01T10:00:00Z'),
          assigneeId: 'test-user-id',
          creatorId: 'test-user-id',
          createdAt: new Date('2024-01-04T10:00:00Z'),
          updatedAt: new Date('2024-01-04T10:00:00Z'),
          assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false },
          creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false },
          lists: [],
          _count: { comments: 0 },
          attachments: [],
        },
      ]

      // Mock Prisma to return tasks in an arbitrary order initially
      mockPrisma.task.findMany.mockResolvedValue(mockTasks)

      const request = createMockRequest()
      const response = await GET(request)
      const responseData = await response.json()

      expect(response.status).toBe(200)
      expect(responseData).toHaveProperty('tasks')

      // Expected order: E, B, C, A, D
      const expectedSortedTaskIds = ['task-E', 'task-B', 'task-C', 'task-A', 'task-D']
      const actualSortedTaskIds = responseData.tasks.map((task: any) => task.id)

      expect(actualSortedTaskIds).toEqual(expectedSortedTaskIds)

      expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
        where: expect.any(Object),
        include: expect.any(Object),
        orderBy: [
          { completed: "asc" },
          { priority: "desc" },
          { dueDateTime: "asc" },
        ],
      })
    })

    it('should return 401 for unauthenticated user', async () => {
      mockGetServerSession.mockResolvedValueOnce(null)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('POST /api/tasks', () => {
    it('should create a new task', async () => {
      const newTaskData = {
        title: 'New Task',
        description: 'New Description',
        priority: 2,
        listIds: ['list-1'],
      }

      const createdTask = {
        id: 'new-task-id',
        ...newTaskData,
        assigneeId: 'test-user-id',
        creatorId: 'test-user-id',
        createdAt: '2025-08-16T18:36:23.755Z',
        updatedAt: '2025-08-16T18:36:23.755Z',
        assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        lists: [],
        comments: []
      }

      mockPrisma.task.create.mockResolvedValue(createdTask)
      // Mock list validation with listMembers including user relation
      mockPrisma.taskList.findMany.mockResolvedValue(rows([{
        id: 'list-1',
        isVirtual: false,
        privacy: 'PRIVATE',
        ownerId: 'test-user-id',
        defaultAssigneeId: undefined,
        listMembers: [{
          userId: 'test-user-id',
          role: 'admin',
          user: {
            id: 'test-user-id',
            name: 'Test User',
            email: 'test@example.com'
          }
        }]
      }]))
      // Mock list findUnique for default assignee check
      // List has no defaultAssigneeId set (undefined) - tasks should be unassigned
      mockPrisma.taskList.findUnique.mockResolvedValue(row({
        id: 'list-1',
        defaultAssigneeId: undefined  // No default assignee set
      }))
      // Mock assignee validation
      mockPrisma.user.findUnique.mockResolvedValue(row({ id: 'test-user-id' }))

      const request = createMockRequest(newTaskData)
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual(createdTask)
      expect(mockPrisma.taskList.findUnique).not.toHaveBeenCalled()
      expect(mockPrisma.task.create).toHaveBeenCalledWith({
        data: {
          title: newTaskData.title.trim(),
          description: newTaskData.description || "",
          priority: newTaskData.priority || 0,
          repeating: "never",
          repeatingData: null,
          isPrivate: true,
          dueDateTime: null,
          isAllDay: false,
          reminderSent: false,
          reminderTime: null,
          reminderType: null,
          completed: false,
          // Unassigned when the list has no default assignee. Written as an
          // explicit null rather than an absent key since the create moved into
          // services/task.service.ts (epic 9dedd8aa) — one data shape for all
          // four surfaces, same row either way.
          assigneeId: null,
          assigneeIds: [],
          creatorId: 'test-user-id',
          identifier: null,
          sequence: null,
          clientRequestId: null,
          parentTaskId: null,
          statusRole: null,
          lists: {
            connect: [{ id: 'list-1' }],
          },
        },
        include: {
          assignee: true,
          creator: true,
          lists: {
            include: {
              owner: true,
              listMembers: {
                include: {
                  user: true
                }
              }
            }
          },
          comments: {
            include: {
              author: true,
            },
          },
          attachments: true,
        },
      })
    })

    it('should handle task creation without listIds', async () => {
      const newTaskData = {
        title: 'New Task',
        description: 'New Description',
      }

      const createdTask = {
        id: 'new-task-id',
        ...newTaskData,
        assigneeId: null,  // No assignee when no list defaults
        creatorId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        assignee: null,
        creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        lists: [],
        comments: []
      }

      mockPrisma.task.create.mockResolvedValue(createdTask)

      const request = createMockRequest(newTaskData)
      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockPrisma.task.create).toHaveBeenCalledWith({
        data: {
          title: newTaskData.title.trim(),
          description: newTaskData.description || "",
          priority: 0,
          repeating: "never",
          repeatingData: null,
          isPrivate: true,
          dueDateTime: null,
          isAllDay: false,
          reminderSent: false,
          reminderTime: null,
          reminderType: null,
          completed: false,
          // Unassigned with no list to take a default from. Explicit null, not
          // an absent key — see the note on the create above (epic 9dedd8aa).
          assigneeId: null,
          assigneeIds: [],
          creatorId: 'test-user-id',
          identifier: null,
          sequence: null,
          clientRequestId: null,
          parentTaskId: null,
          statusRole: null,
          lists: {
            connect: [],
          },
        },
        include: {
          assignee: true,
          creator: true,
          lists: {
            include: {
              owner: true,
              listMembers: {
                include: {
                  user: true
                }
              }
            }
          },
          comments: {
            include: {
              author: true,
            },
          },
          attachments: true,
        },
      })
    })

    it('should return 400 for missing title', async () => {
      const invalidData = {
        description: 'Description without title',
      }

      const request = createMockRequest(invalidData)
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Title is required')
    })

    it('should create a task with custom weekly repeating data (NLP parsed "weekly Monday")', async () => {
      // This test verifies that customRepeatingData from NLP parsing (e.g., "weekly Monday exercise")
      // is correctly saved as repeatingData in the database
      const newTaskData = {
        title: 'exercise',
        repeating: 'custom',
        customRepeatingData: {
          type: 'custom',
          unit: 'weeks',
          interval: 1,
          weekdays: ['monday'],
          endCondition: 'never'
        },
        dueDateTime: new Date('2026-01-26T08:00:00.000Z'), // Next Monday
        isAllDay: true,
      }

      const createdTask = {
        id: 'new-task-id',
        title: 'exercise',
        description: '',
        priority: 0,
        repeating: 'custom',
        repeatingData: {
          type: 'custom',
          unit: 'weeks',
          interval: 1,
          weekdays: ['monday'],
          endCondition: 'never'
        },
        dueDateTime: new Date('2026-01-26T08:00:00.000Z'),
        isAllDay: true,
        completed: false,
        assigneeId: null,
        creatorId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        assignee: null,
        creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        lists: [],
        comments: []
      }

      mockPrisma.task.create.mockResolvedValue(createdTask)

      const request = createMockRequest(newTaskData)
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.repeating).toBe('custom')
      expect(data.repeatingData).toEqual({
        type: 'custom',
        unit: 'weeks',
        interval: 1,
        weekdays: ['monday'],
        endCondition: 'never'
      })

      // Verify the API correctly maps customRepeatingData to repeatingData
      expect(mockPrisma.task.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          title: 'exercise',
          repeating: 'custom',
          repeatingData: {
            type: 'custom',
            unit: 'weeks',
            interval: 1,
            weekdays: ['monday'],
            endCondition: 'never'
          },
        }),
        include: expect.any(Object),
      })
    })
  })
})
