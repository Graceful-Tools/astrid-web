import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/lists/[id]/route'
import { POST } from '@/app/api/lists/route'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'

// Mock NextAuth
vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    listMember: {
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

describe('List Default Due Date API', () => {
  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test User'
  }

  const mockSession = {
    user: mockUser
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue(mockSession)
    ;(prisma.$transaction as any).mockImplementation((operation: any) => operation(prisma))
    vi.mocked(prisma.listMember.createMany).mockResolvedValue({ count: 1 })
  })

  describe('POST /api/lists', () => {
    it('should create list with default due date', async () => {
      const mockCreatedList = {
        id: 'list-123',
        name: 'Test List',
        description: 'A test list',
        color: '#3b82f6',
        privacy: 'PRIVATE',
        imageUrl: null, // No image initially
        ownerId: mockUser.id,
        defaultDueDate: 'tomorrow',
        defaultPriority: 1,
        defaultRepeating: 'never',
        defaultIsPrivate: true,
        owner: mockUser,
        admins: [],
        members: [],
        defaultAssignee: null,
        _count: { tasks: 0 }
      }

      const mockUpdatedList = {
        ...mockCreatedList,
        imageUrl: 'default-image.jpg'
      }

      vi.mocked(prisma.taskList.create).mockResolvedValue(mockCreatedList as any)
      vi.mocked(prisma.taskList.update).mockResolvedValue(mockUpdatedList as any)

      const request = new NextRequest('http://localhost/api/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test List',
          description: 'A test list',
          privacy: 'PRIVATE',
          defaultDueDate: 'tomorrow',
          defaultPriority: 1,
          defaultRepeating: 'never',
          defaultIsPrivate: true,
        })
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.defaultDueDate).toBe('tomorrow')
      expect(data.name).toBe('Test List')
      
      // Verify Prisma was called with correct data
      expect(vi.mocked(prisma.taskList.create)).toHaveBeenCalledWith({
        data: expect.objectContaining({
          name: 'Test List',
          defaultDueDate: 'tomorrow',
          defaultPriority: 1,
          defaultRepeating: 'never',
          defaultIsPrivate: true,
        }),
        include: expect.any(Object),
      })
    })

    it('should handle all default due date options', async () => {
      const testCases = ['none', 'today', 'tomorrow', 'next_week']

      for (const dueDate of testCases) {
        const mockList = {
          id: 'list-123',
          name: 'Test List',
          imageUrl: null,
          defaultDueDate: dueDate,
          owner: mockUser,
          admins: [],
          members: [],
          defaultAssignee: null,
          _count: { tasks: 0 }
        }

        const mockUpdatedList = {
          ...mockList,
          imageUrl: 'default-image.jpg'
        }

        vi.mocked(prisma.taskList.create).mockResolvedValue(mockList as any)
        vi.mocked(prisma.taskList.update).mockResolvedValue(mockUpdatedList as any)

        const request = new NextRequest('http://localhost/api/lists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Test List',
            privacy: 'PRIVATE',
            defaultDueDate: dueDate,
          })
        })

        const response = await POST(request)
        const data = await response.json()

        expect(response.status).toBe(200)
        expect(data.defaultDueDate).toBe(dueDate)
      }
    })
  })

  describe('PUT /api/lists/[id]', () => {
    it('should update list default due date', async () => {
      const existingList = {
        id: 'list-123',
        name: 'Test List',
        defaultDueDate: 'none',
        ownerId: mockUser.id,
        admins: [],
        members: [],
      }

      const updatedList = {
        ...existingList,
        defaultDueDate: 'next_week',
        owner: mockUser,
        defaultAssignee: null,
        _count: { tasks: 0 }
      }

      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(existingList as any)
      vi.mocked(prisma.taskList.update).mockResolvedValue(updatedList as any)

      const request = new NextRequest('http://localhost/api/lists/list-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test List',
          defaultDueDate: 'next_week',
        })
      })

      const response = await PUT(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.defaultDueDate).toBe('next_week')
      
      // Verify Prisma was called with correct update data
      expect(vi.mocked(prisma.taskList.update)).toHaveBeenCalledWith({
        where: { id: 'list-123' },
        data: expect.objectContaining({
          defaultDueDate: 'next_week',
        }),
        include: expect.any(Object),
      })
    })

    it('should require proper permissions to update list', async () => {
      const existingList = {
        id: 'list-123',
        name: 'Test List',
        ownerId: 'different-user-id', // Different owner
        admins: [],
        members: [],
      }

      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(existingList as any)

      const request = new NextRequest('http://localhost/api/lists/list-123', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test List',
          defaultDueDate: 'tomorrow',
        })
      })

      const response = await PUT(request, { params: { id: 'list-123' } })

      expect(response.status).toBe(403)
    })
  })

  describe('Date Logic Validation', () => {
    it('validates default due date values', () => {
      // Test the date calculation logic that would be used in task form
      const today = new Date('2025-01-15') // Fixed date for testing
      
      const testCases = [
        { input: 'today', expected: new Date('2025-01-15') },
        { input: 'tomorrow', expected: new Date('2025-01-16') },
        { input: 'next_week', expected: new Date('2025-01-22') },
        { input: 'none', expected: null }
      ]

      testCases.forEach(({ input, expected }) => {
        let result: Date | null = null
        
        if (input !== 'none') {
          switch (input) {
            case 'today':
              result = today
              break
            case 'tomorrow':
              result = new Date(today)
              result.setDate(result.getDate() + 1)
              break
            case 'next_week':
              result = new Date(today)
              result.setDate(result.getDate() + 7)
              break
          }
        }

        if (expected === null) {
          expect(result).toBeNull()
        } else {
          expect(result?.toISOString().split('T')[0]).toBe(expected.toISOString().split('T')[0])
        }
      })
    })
  })
})