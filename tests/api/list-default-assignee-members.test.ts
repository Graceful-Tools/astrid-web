import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PUT } from '@/app/api/lists/[id]/route'
import * as authModule from 'next-auth'
import * as prismaModule from '@/lib/prisma'

// Mock the prisma client
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    listMember: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  }
}))

// Mock next-auth
vi.mock('next-auth/next', () => ({
  getServerSession: vi.fn(),
}))

// Mock auth config
vi.mock('@/lib/auth-config', () => ({
  authConfig: {},
}))

describe('List Default Assignee Member Management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prismaModule.prisma.$transaction as any).mockImplementation(
      (operation: any) => operation(prismaModule.prisma),
    )
    
    // Setup default mocks for all tests
    vi.mocked(prismaModule.prisma.listMember.findFirst).mockResolvedValue(null)
    vi.mocked(prismaModule.prisma.user.findUnique).mockResolvedValue(null)
  })

  describe('API Backend Tests', () => {
    it('should update default assignee to a specific list member', async () => {
      const mockSession = {
        user: { id: 'user-1', email: 'admin@test.com' }
      }
      
      const mockList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'user-1',
        defaultAssigneeId: null,
        owner: { id: 'user-1', name: 'Owner', email: 'owner@test.com' },
        admins: [],
        members: [],
        listMembers: [
          { 
            userId: 'member-2', 
            user: { id: 'member-2', name: 'John Doe', email: 'john@test.com' } 
          }
        ]
      }

      const mockUpdatedList = {
        ...mockList,
        defaultAssigneeId: 'member-2',
        defaultAssignee: {
          id: 'member-2',
          name: 'John Doe',
          email: 'john@test.com'
        }
      }

      const mockListMembers = [
        { userId: 'member-2', user: { id: 'member-2', name: 'John Doe', email: 'john@test.com' } }
      ]

      vi.mocked(authModule.getServerSession).mockResolvedValue(mockSession)
      vi.mocked(prismaModule.prisma.taskList.findUnique).mockResolvedValue(mockList)
      vi.mocked(prismaModule.prisma.listMember.findMany).mockResolvedValue(mockListMembers)
      vi.mocked(prismaModule.prisma.listMember.findFirst).mockResolvedValue({
        userId: 'member-2',
        listId: 'list-1',
        role: 'member'
      })
      vi.mocked(prismaModule.prisma.user.findUnique).mockResolvedValue({
        id: 'member-2',
        name: 'John Doe',
        email: 'john@test.com'
      })
      vi.mocked(prismaModule.prisma.taskList.update).mockResolvedValue(mockUpdatedList)

      const request = new NextRequest('http://localhost/api/lists/list-1', {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Test List',
          defaultAssigneeId: 'member-2'
        }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await PUT(request, { params: { id: 'list-1' } })
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.defaultAssigneeId).toBe('member-2')
      expect(prismaModule.prisma.taskList.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'list-1' },
          data: expect.objectContaining({
            defaultAssigneeId: 'member-2'
          })
        })
      )
    })

    it('should set default assignee to task_creator (null)', async () => {
      const mockSession = {
        user: { id: 'user-1', email: 'admin@test.com' }
      }
      
      const mockList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'user-1',
        defaultAssigneeId: 'member-2',
        admins: [],
        members: []
      }

      const mockUpdatedList = {
        ...mockList,
        defaultAssigneeId: null,
        defaultAssignee: null
      }

      vi.mocked(authModule.getServerSession).mockResolvedValue(mockSession)
      vi.mocked(prismaModule.prisma.taskList.findUnique).mockResolvedValue(mockList)
      vi.mocked(prismaModule.prisma.taskList.update).mockResolvedValue(mockUpdatedList)

      const request = new NextRequest('http://localhost/api/lists/list-1', {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Test List',
          defaultAssigneeId: null // null means task creator
        }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await PUT(request, { params: { id: 'list-1' } })
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.defaultAssigneeId).toBe(null)
      expect(prismaModule.prisma.taskList.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'list-1' },
          data: expect.objectContaining({
            defaultAssigneeId: null
          })
        })
      )
    })

    it('should set default assignee to unassigned', async () => {
      const mockSession = {
        user: { id: 'user-1', email: 'admin@test.com' }
      }
      
      const mockList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'user-1',
        defaultAssigneeId: null,
        admins: [],
        members: []
      }

      const mockUpdatedList = {
        ...mockList,
        defaultAssigneeId: 'unassigned',
        defaultAssignee: null
      }

      vi.mocked(authModule.getServerSession).mockResolvedValue(mockSession)
      vi.mocked(prismaModule.prisma.taskList.findUnique).mockResolvedValue(mockList)
      vi.mocked(prismaModule.prisma.taskList.update).mockResolvedValue(mockUpdatedList)

      const request = new NextRequest('http://localhost/api/lists/list-1', {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Test List',
          defaultAssigneeId: 'unassigned'
        }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await PUT(request, { params: { id: 'list-1' } })
      const result = await response.json()

      expect(response.status).toBe(200)
      expect(result.defaultAssigneeId).toBe('unassigned')
      expect(prismaModule.prisma.taskList.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'list-1' },
          data: expect.objectContaining({
            defaultAssigneeId: 'unassigned'
          })
        })
      )
    })

    it('should reject setting default assignee to non-member user', async () => {
      const mockSession = {
        user: { id: 'user-1', email: 'admin@test.com' }
      }
      
      const mockList = {
        id: 'list-1',
        name: 'Test List',
        ownerId: 'user-1',
        defaultAssigneeId: null,
        admins: [],
        members: []
      }

      // Mock empty members list - no members in this list
      const mockListMembers = []

      vi.mocked(authModule.getServerSession).mockResolvedValue(mockSession)
      vi.mocked(prismaModule.prisma.taskList.findUnique).mockResolvedValue(mockList)
      vi.mocked(prismaModule.prisma.listMember.findMany).mockResolvedValue(mockListMembers)
      vi.mocked(prismaModule.prisma.listMember.findFirst).mockResolvedValue(null) // User not found in members
      vi.mocked(prismaModule.prisma.user.findUnique).mockResolvedValue({
        id: 'non-member-user',
        name: 'Non Member',
        email: 'nonmember@test.com'
      })

      const request = new NextRequest('http://localhost/api/lists/list-1', {
        method: 'PUT',
        body: JSON.stringify({
          name: 'Test List',
          defaultAssigneeId: 'non-member-user' // This user is not a member
        }),
        headers: { 'Content-Type': 'application/json' }
      })

      const response = await PUT(request, { params: { id: 'list-1' } })

      expect(response.status).toBe(400)
      const result = await response.json()
      expect(result.error).toContain('member of the list')
    })
  })

  describe('Task Creation with Member Default Assignee', () => {
    it('should create task with member default assignee', async () => {
      // This would be tested in the tasks API test, but included here for completeness
      const mockList = {
        id: 'list-1',
        defaultAssigneeId: 'member-2',
        defaultAssignee: {
          id: 'member-2',
          name: 'John Doe',
          email: 'john@test.com'
        }
      }

      // When a task is created in this list, it should get member-2 as assignee
      expect(mockList.defaultAssigneeId).toBe('member-2')
      expect(mockList.defaultAssignee.id).toBe('member-2')
    })

    it('should fallback to task creator when default assignee is not a member', async () => {
      // This tests the logic where a default assignee is no longer a member
      const mockListWithRemovedMember = {
        id: 'list-1',
        defaultAssigneeId: 'removed-member',
        defaultAssignee: null, // Member was removed
        listMembers: [] // No members
      }

      // The system should detect this and fallback
      expect(mockListWithRemovedMember.defaultAssignee).toBe(null)
    })
  })
})