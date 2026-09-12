import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/lists/[id]/route'
import { mockPrisma, mockGetServerSession } from '../setup'

// Mock NextRequest
const createMockRequest = (listId: string) => {
  const request = new NextRequest(`http://localhost:3000/api/lists/${listId}`)
  return request
}

describe('List Unique URL API (/api/lists/[id])', () => {
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

    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockGetServerSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com' }
    })

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual(mockList)
    expect(mockPrisma.taskList.findUnique).toHaveBeenCalledWith({
      where: { id: listId },
      include: expect.objectContaining({
        owner: true,
        listMembers: { include: { user: true } },
        tasks: expect.any(Object),
      }),
    })
  })

  it('should return 404 for non-existent list', async () => {
    const listId = 'non-existent-list'
    
    mockPrisma.taskList.findUnique.mockResolvedValue(null)
    mockGetServerSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com' }
    })

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('List not found')
  })

  it('should return 403 for unauthorized user trying to access private list', async () => {
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

    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockGetServerSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com' }
    })

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Forbidden')
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

    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockGetServerSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com' }
    })

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual(mockList)
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

    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockGetServerSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com' }
    })

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual(mockList)
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

    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockGetServerSession.mockResolvedValue({
      user: { id: 'test-user-id', email: 'test@example.com' }
    })

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual(mockList)
  })

  it('should return 401 for unauthenticated user', async () => {
    const listId = 'test-list-id'
    
    mockGetServerSession.mockResolvedValue(null)

    const request = createMockRequest(listId)
    const response = await GET(request, { params: Promise.resolve({ id: listId }) })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })
})