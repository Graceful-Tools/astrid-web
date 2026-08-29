import { describe, it, expect, beforeEach, vi } from 'vitest'

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

let GET: any, POST: any, PUT: any, DELETE: any;

describe('Tasks API', () => {
  beforeEach(async () => {
    vi.resetModules()
    // Re-apply the mock for prisma after resetting modules
    vi.mock('@/lib/prisma', () => ({
      prisma: mockPrisma,
    }))
    // Dynamically import the API routes
    const tasksRoute = await import('@/app/api/tasks/route');
    GET = tasksRoute.GET;
    POST = tasksRoute.POST;
    const taskIdRoute = await import('@/app/api/tasks/[id]/route');
    PUT = taskIdRoute.PUT;
    DELETE = taskIdRoute.DELETE;

    vi.clearAllMocks()
    // Mock user exists in database
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'test-user-id',
      name: 'Test User',
      email: 'test@example.com',
      image: 'test-image-url',
      createdAt: new Date(),
      updatedAt: new Date(),
      emailVerified: null
    })
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
                    { privacy: 'PUBLIC' }
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
      mockPrisma.taskList.findMany.mockResolvedValue([{
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
      }])
      // Mock list findUnique for default assignee check
      // List has no defaultAssigneeId set (undefined) - tasks should be unassigned
      mockPrisma.taskList.findUnique.mockResolvedValue({
        id: 'list-1',
        defaultAssigneeId: undefined  // No default assignee set
      })
      // Mock assignee validation
      mockPrisma.user.findUnique.mockResolvedValue({ id: 'test-user-id' })

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
          // NO assigneeId - task should be unassigned when list has no default assignee
          creatorId: 'test-user-id',
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
          // NO assigneeId - task should be unassigned when no list or list defaults
          creatorId: 'test-user-id',
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

  describe('PUT /api/tasks/[id]', () => {
    beforeEach(() => {
      // Mock an existing task for PUT and DELETE tests
      mockPrisma.task.findUnique.mockResolvedValue({
        id: 'task-to-update',
        title: 'Original Task Title',
        description: 'Original Description',
        completed: false,
        priority: 1,
        assigneeId: 'test-user-id',
        creatorId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        dueDateTime: null,
        // Mock lists with necessary properties for permission checks
        lists: [
          {
            id: 'list-1',
            name: 'Test List',
            ownerId: 'test-user-id',
            privacy: 'PRIVATE',
            publicListType: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            listMembers: [
              { userId: 'test-user-id', role: 'admin', createdAt: new Date(), updatedAt: new Date(), listId: 'list-1', user: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false } }
            ]
          }
        ],
        comments: [],
        attachments: [],
        workflowMetadata: null,
        repeating: 'never',
        repeatFrom: null,
        repeatingData: null,
      });
      // Mock user.findUnique for assignee check in PUT route
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        name: 'Test User',
        email: 'test@example.com',
        image: null,
        isAIAgent: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        emailVerified: null
      });

    });

    it('should update an existing task', { timeout: 30000 }, async () => {
      const updateData = {
        title: 'Updated Task',
        description: 'Updated Description',
        completed: true,
      }

      const existingTask = {
        id: 'task-1',
        title: 'Original Task',
        assigneeId: 'test-user-id',
        creatorId: 'test-user-id',
        lists: []
      }

      const updatedTask = {
        ...existingTask,
        ...updateData,
        assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        lists: [],
        comments: [null, null, null]  // State change comments created but mocks return null
      }

      mockPrisma.task.findUnique.mockResolvedValue(existingTask)
      mockPrisma.task.update.mockResolvedValue(updatedTask)

      const request = createMockRequest(updateData)
      const response = await PUT(request, { params: { id: 'task-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      // Check main fields (comments array may have mocked null values)
      expect(data.id).toBe(updatedTask.id)
      expect(data.title).toBe(updatedTask.title)
      expect(data.description).toBe(updatedTask.description)
      expect(data.completed).toBe(updatedTask.completed)
      expect(data.assigneeId).toBe(updatedTask.assigneeId)
      expect(Array.isArray(data.comments)).toBe(true)
    })

    it('should preserve task lists when not provided in update', async () => {
      const existingTask = {
        id: 'task-1',
        title: 'Original Task',
        description: 'Original Description',
        priority: 1,
        assigneeId: 'test-user-id',
        creatorId: 'test-user-id',
        repeating: 'never',
        isPrivate: false,
        completed: false,
        when: new Date('2024-01-01'),
        lists: [{ id: 'list-1' }, { id: 'list-2' }],
        comments: [],
        attachments: []
      }

      const updateData = {
        title: 'Updated Task',
        description: 'Updated Description'
        // Notice: listIds is NOT provided
      }

      const updatedTask = {
        ...existingTask,
        ...updateData,
        assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' }
      }

      mockPrisma.task.findUnique.mockResolvedValue(existingTask)
      mockPrisma.task.update.mockResolvedValue(updatedTask)

      const request = createMockRequest(updateData)
      const response = await PUT(request, { params: { id: 'task-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.lists).toEqual([{ id: 'list-1' }, { id: 'list-2' }])
      
      // Verify the update call didn't include lists field (undefined means no update)
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          title: 'Updated Task',
          description: 'Updated Description',
          priority: undefined,
          repeating: undefined,
          repeatingData: null, // Sanitized to null when repeating is not custom
          isPrivate: undefined,
          completed: undefined,
          dueDateTime: null, // Date clearing sets to null
          isAllDay: false,
          assigneeId: undefined,
          lists: undefined, // This is key - undefined means preserve existing
        },
        include: expect.objectContaining({
          assignee: true,
          creator: true,
          lists: expect.any(Object),
          comments: expect.any(Object),
          attachments: true
        })
      })
    })

    it('should update task lists when explicitly provided', async () => {
      const existingTask = {
        id: 'task-1',
        title: 'Original Task',
        assigneeId: 'test-user-id',
        creatorId: 'test-user-id',
        lists: [{ id: 'list-1' }, { id: 'list-2' }],
        comments: [],
        attachments: []
      }

      const updateData = {
        title: 'Updated Task',
        listIds: ['list-3', 'list-4'] // Explicitly changing lists
      }

      const updatedTask = {
        ...existingTask,
        ...updateData,
        lists: [{ id: 'list-3' }, { id: 'list-4' }],
        assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' }
      }

      mockPrisma.task.findUnique.mockResolvedValue(existingTask)
      mockPrisma.task.update.mockResolvedValue(updatedTask)

      // Mock list access validation - user has access to target lists
      mockPrisma.taskList.findMany.mockResolvedValue([
        { id: 'list-3', name: 'List 3', ownerId: 'test-user-id', privacy: 'PRIVATE', isVirtual: false, owner: { id: 'test-user-id' }, listMembers: [] },
        { id: 'list-4', name: 'List 4', ownerId: 'test-user-id', privacy: 'PRIVATE', isVirtual: false, owner: { id: 'test-user-id' }, listMembers: [] }
      ])

      const request = createMockRequest(updateData)
      const response = await PUT(request, { params: { id: 'task-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.lists).toEqual([{ id: 'list-3' }, { id: 'list-4' }])
      
      // Verify lists were explicitly updated
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          title: 'Updated Task',
          description: undefined,
          priority: undefined,
          repeating: undefined,
          repeatingData: null,
          isPrivate: undefined,
          completed: undefined,
          dueDateTime: null, // Date clearing sets to null
          isAllDay: false,
          assigneeId: undefined,
          lists: {
            set: [{ id: 'list-3' }, { id: 'list-4' }]
          },
        },
        include: expect.objectContaining({
          assignee: true,
          creator: true,
          lists: expect.any(Object),
          comments: expect.any(Object),
          attachments: true
        })
      })
    })

    it('should clear task lists when empty array provided', async () => {
      const existingTask = {
        id: 'task-1',
        title: 'Original Task',
        assigneeId: 'test-user-id',
        creatorId: 'test-user-id',
        lists: [{ id: 'list-1' }, { id: 'list-2' }],
        comments: [],
        attachments: []
      }

      const updateData = {
        title: 'Updated Task',
        listIds: [] // Explicitly clearing lists
      }

      const updatedTask = {
        ...existingTask,
        ...updateData,
        lists: [],
        assignee: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' },
        creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' }
      }

      mockPrisma.task.findUnique.mockResolvedValue(existingTask)
      mockPrisma.task.update.mockResolvedValue(updatedTask)

      const request = createMockRequest(updateData)
      const response = await PUT(request, { params: { id: 'task-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.lists).toEqual([])
      
      // Verify lists were cleared
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          title: 'Updated Task',
          description: undefined,
          priority: undefined,
          repeating: undefined,
          repeatingData: null,
          isPrivate: undefined,
          completed: undefined,
          dueDateTime: null, // Date clearing sets to null
          isAllDay: false,
          assigneeId: undefined,
          lists: {
            set: []
          },
        },
        include: expect.objectContaining({
          assignee: true,
          creator: true,
          lists: expect.any(Object),
          comments: expect.any(Object),
          attachments: true
        })
      })
    })

    it('should preserve all other task properties when updating only title', async () => {
      const existingTask = {
        id: 'task-1',
        title: 'Original Task',
        description: 'Original Description',
        priority: 2,
        assigneeId: 'assignee-id',
        creatorId: 'test-user-id',
        repeating: 'weekly',
        repeatingData: { dayOfWeek: 1 },
        isPrivate: true,
        completed: false,
        when: new Date('2024-12-25'),
        lists: [{ id: 'important-list' }],
        comments: [],
        attachments: []
      }

      const updateData = {
        title: 'Updated Title Only'
        // All other properties should be preserved
      }

      const updatedTask = {
        ...existingTask,
        title: 'Updated Title Only',
        assignee: { id: 'assignee-id', name: 'Assignee User', email: 'assignee@example.com' },
        creator: { id: 'test-user-id', name: 'Test User', email: 'test@example.com' }
      }

      mockPrisma.task.findUnique.mockResolvedValue(existingTask)
      mockPrisma.task.update.mockResolvedValue(updatedTask)

      const request = createMockRequest(updateData)
      const response = await PUT(request, { params: { id: 'task-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.title).toBe('Updated Title Only')
      expect(data.description).toBe('Original Description')
      expect(data.priority).toBe(2)
      expect(data.assigneeId).toBe('assignee-id')
      expect(data.repeating).toBe('weekly')
      expect(data.isPrivate).toBe(true)
      expect(data.completed).toBe(false)
      expect(data.lists).toEqual([{ id: 'important-list' }])
      
      // Verify only title was updated, all else undefined (preserved)
      expect(mockPrisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-1' },
        data: {
          title: 'Updated Title Only',
          description: undefined,
          priority: undefined,
          repeating: undefined,
          repeatingData: null,
          isPrivate: undefined,
          completed: undefined,
          dueDateTime: null, // Date clearing sets to null
          isAllDay: false,
          assigneeId: undefined,
          lists: undefined,
        },
        include: expect.objectContaining({
          assignee: true,
          creator: true,
          lists: expect.any(Object),
          comments: expect.any(Object),
          attachments: true
        })
      })
    })

    it('should return 404 for non-existent task', async () => {
      mockPrisma.task.findUnique.mockResolvedValue(null)

      const request = createMockRequest({ title: 'Updated Task' })
      const response = await PUT(request, { params: { id: 'non-existent' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Task not found')
    })
  })

  describe('DELETE /api/tasks/[id]', () => {
    beforeEach(() => {
      // Mock an existing task for DELETE tests
      mockPrisma.task.findUnique.mockResolvedValue({
        id: 'task-to-delete',
        title: 'Task to Delete',
        description: 'Description to Delete',
        completed: false,
        priority: 1,
        assigneeId: 'test-user-id',
        creatorId: 'test-user-id',
        createdAt: new Date(),
        updatedAt: new Date(),
        dueDateTime: null,
        lists: [
          {
            id: 'list-1',
            name: 'Test List',
            ownerId: 'test-user-id',
            privacy: 'PRIVATE',
            publicListType: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            listMembers: [
              { userId: 'test-user-id', role: 'admin', createdAt: new Date(), updatedAt: new Date(), listId: 'list-1', user: { id: 'test-user-id', name: 'Test User', email: 'test@example.com', image: null, isAIAgent: false } }
            ]
          }
        ],
        comments: [],
        attachments: [],
        workflowMetadata: null,
        repeating: 'never',
        repeatFrom: null,
        repeatingData: null,
      });

    });

    it('should delete a task', async () => {
      const existingTask = {
        id: 'task-1',
        creatorId: 'test-user-id',
        lists: []
      }

      mockPrisma.task.findUnique.mockResolvedValue(existingTask)
      mockPrisma.task.delete.mockResolvedValue(existingTask)

      const request = createMockRequest()
      const response = await DELETE(request, { params: { id: 'task-1' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
    })

    it('should return 403 for unauthorized delete', async () => {
      const existingTask = {
        id: 'task-1',
        creatorId: 'other-user-id',
        lists: []
      }

      mockPrisma.task.findUnique.mockResolvedValue(existingTask)

      const request = createMockRequest()
      const response = await DELETE(request, { params: { id: 'task-1' } })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Forbidden')
    })
  })
})
