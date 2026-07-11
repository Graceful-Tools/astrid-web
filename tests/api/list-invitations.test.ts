import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '@/app/api/lists/[id]/invite/route'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { sendListInvitationEmail } from '@/lib/email'
import { canUserManageMembers, canAssignRole, prismaToTaskList } from '@/lib/list-permissions'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findUnique: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    invitation: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendListInvitationEmail: vi.fn(),
}))

vi.mock('@/lib/list-permissions', () => ({
  canUserManageMembers: vi.fn(),
  canAssignRole: vi.fn(),
  prismaToTaskList: vi.fn(),
}))

const mockUser = {
  id: 'user-123',
  email: 'owner@example.com',
  name: 'List Owner',
}

const mockList = {
  id: 'list-123',
  name: 'Test List',
  ownerId: 'user-123',
  owner: mockUser,
  admins: [],
  members: [],
}

const mockTaskList = {
  id: 'list-123',
  name: 'Test List',
  ownerId: 'user-123',
  owner: mockUser,
  admins: [],
  members: [],
}

describe('/api/lists/[id]/invite', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue({
      user: mockUser,
    } as any)
    vi.mocked(prismaToTaskList).mockReturnValue(mockTaskList as any)
    vi.mocked(canUserManageMembers).mockReturnValue(true)
    vi.mocked(canAssignRole).mockReturnValue(true)
  })

  describe('POST - Invite user to list', () => {
    it('should create invitation for new user', async () => {
      const mockInvitation = {
        id: 'invitation-123',
        email: 'newuser@example.com',
        token: 'inv_1234567890_abcdef',
        type: 'LIST_SHARING',
        listId: 'list-123',
        role: 'member',
        message: 'Join my list!',
        senderId: 'user-123',
        receiverId: undefined,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      }

      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(mockList as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null) // User doesn't exist
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null) // No existing invitation
      vi.mocked(prisma.invitation.create).mockResolvedValue(mockInvitation as any)
      vi.mocked(sendListInvitationEmail).mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/lists/list-123/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'newuser@example.com',
          role: 'member',
          message: 'Join my list!',
        }),
      })

      const response = await POST(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.message).toBe('Invitation sent successfully')
      expect(data.invitation.email).toBe('newuser@example.com')
      expect(data.invitation.role).toBe('member')
      expect(data.invitation.type).toBe('LIST_SHARING')

      expect(prisma.invitation.create).toHaveBeenCalledWith({
        data: {
          email: 'newuser@example.com',
          token: expect.stringMatching(/^inv_[a-f0-9]{32}$/),
          type: 'LIST_SHARING',
          listId: 'list-123',
          role: 'member',
          message: 'Join my list!',
          senderId: 'user-123',
          receiverId: undefined,
          expiresAt: expect.any(Date),
        },
      })

      expect(sendListInvitationEmail).toHaveBeenCalledWith({
        to: 'newuser@example.com',
        inviterName: 'List Owner',
        listName: 'Test List',
        role: 'member',
        invitationUrl: expect.stringContaining('/invite/inv_'),
        message: 'Join my list!',
      })
    })

    it('should create invitation for existing user', async () => {
      const existingUser = {
        id: 'existing-user-456',
        email: 'existing@example.com',
        name: 'Existing User',
      }

      const mockInvitation = {
        id: 'invitation-456',
        email: 'existing@example.com',
        token: 'inv_1234567890_xyz789',
        type: 'LIST_SHARING',
        listId: 'list-123',
        role: 'admin',
        message: null,
        senderId: 'user-123',
        receiverId: 'existing-user-456',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      }

      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(mockList as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser as any)
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.invitation.create).mockResolvedValue(mockInvitation as any)
      vi.mocked(sendListInvitationEmail).mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/lists/list-123/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'existing@example.com',
          role: 'admin',
        }),
      })

      const response = await POST(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.invitation.email).toBe('existing@example.com')
      expect(data.invitation.role).toBe('admin')

      expect(prisma.invitation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: 'existing@example.com',
          role: 'admin',
          receiverId: 'existing-user-456',
        }),
      })

      expect(sendListInvitationEmail).toHaveBeenCalledWith({
        to: 'existing@example.com',
        inviterName: 'List Owner',
        listName: 'Test List',
        role: 'manager', // admin -> manager display name
        invitationUrl: expect.stringContaining('/invite/inv_'),
        message: undefined,
      })
    })

    it('should reject invitation for user already in list', async () => {
      const existingMember = {
        id: 'member-456',
        email: 'member@example.com',
        name: 'Existing Member',
      }

      const listWithMembers = {
        ...mockList,
        listMembers: [{
          id: 'list-member-1',
          listId: 'list-123',
          userId: 'member-456',
          role: 'member',
          user: existingMember
        }],
      }

      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(listWithMembers as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(existingMember as any)

      const request = new Request('http://localhost:3000/api/lists/list-123/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'member@example.com',
          role: 'member',
        }),
      })

      const response = await POST(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('User is already a member of this list')
    })

    it('should reject duplicate pending invitation', async () => {
      const existingInvitation = {
        id: 'existing-invitation',
        email: 'invited@example.com',
        listId: 'list-123',
        status: 'PENDING',
        type: 'LIST_SHARING',
      }

      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(mockList as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(existingInvitation as any)

      const request = new Request('http://localhost:3000/api/lists/list-123/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invited@example.com',
          role: 'member',
        }),
      })

      const response = await POST(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Invitation already pending for this user')
    })

    it('should require valid email format', async () => {
      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(mockList as any)

      const request = new Request('http://localhost:3000/api/lists/list-123/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: '',
          role: 'member',
        }),
      })

      const response = await POST(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email and role are required')
    })

    it('should require valid role', async () => {
      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(mockList as any)

      const request = new Request('http://localhost:3000/api/lists/list-123/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          role: 'invalid-role',
        }),
      })

      const response = await POST(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe("Invalid role. Must be 'admin' or 'member'")
    })

    it('should return 404 for non-existent list', async () => {
      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/lists/nonexistent/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          role: 'member',
        }),
      })

      const response = await POST(request, { params: { id: 'nonexistent' } })
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('List not found')
    })

    it('should require authentication', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/lists/list-123/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          role: 'member',
        }),
      })

      const response = await POST(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should check user permissions to manage members', async () => {
      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(mockList as any)
      vi.mocked(canUserManageMembers).mockReturnValue(false)

      const request = new Request('http://localhost:3000/api/lists/list-123/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          role: 'member',
        }),
      })

      const response = await POST(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Access denied')
    })

    it('should check user permissions to assign role', async () => {
      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(mockList as any)
      vi.mocked(canUserManageMembers).mockReturnValue(true)
      vi.mocked(canAssignRole).mockReturnValue(false)

      const request = new Request('http://localhost:3000/api/lists/list-123/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          role: 'admin',
        }),
      })

      const response = await POST(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Cannot assign this role')
    })

    it('should continue if email sending fails', async () => {
      const mockInvitation = {
        id: 'invitation-123',
        email: 'test@example.com',
        token: 'inv_1234567890_abcdef',
        type: 'LIST_SHARING',
        listId: 'list-123',
        role: 'member',
        message: null,
        senderId: 'user-123',
        receiverId: undefined,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      }

      vi.mocked(prisma.taskList.findUnique).mockResolvedValue(mockList as any)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.invitation.create).mockResolvedValue(mockInvitation as any)
      vi.mocked(sendListInvitationEmail).mockRejectedValue(new Error('Email service down'))
      const request = new Request('http://localhost:3000/api/lists/list-123/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          role: 'member',
        }),
      })

      const response = await POST(request, { params: { id: 'list-123' } })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.message).toBe('Invitation sent successfully')
    })
  })
})