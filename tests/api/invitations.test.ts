import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET, POST } from '@/app/api/invitations/route'
import { GET as GetInvitation, POST as AcceptInvitation, DELETE as DeclineInvitation } from '@/app/api/invitations/[token]/route'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { sendInvitationEmail } from '@/lib/email'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    invitation: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    task: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    taskList: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendInvitationEmail: vi.fn(),
}))

vi.mock('@/lib/redis', () => ({
  RedisCache: {
    del: vi.fn().mockResolvedValue(undefined),
    keys: { userLists: (id: string) => `lists:user:${id}` },
  },
}))

const mockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  name: 'Test User',
}

const mockList = {
  id: 'list-123',
  name: 'Test List',
  ownerId: 'user-123',
}

const mockTask = {
  id: 'task-123',
  title: 'Test Task',
}

describe('/api/invitations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue({
      user: mockUser,
    } as any)
  })

  describe('POST - Create invitation', () => {
    it('should create a valid list sharing invitation', async () => {
      const mockInvitation = {
        id: 'invitation-123',
        email: 'invite@example.com',
        token: 'inv_1234567890_abcdef',
        type: 'LIST_SHARING',
        senderId: 'user-123',
        listId: 'list-123',
        role: 'member',
        message: 'Join my list!',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        sender: {
          name: 'Test User',
          email: 'test@example.com',
        },
      }

      vi.mocked(prisma.user.findUnique).mockResolvedValue(null) // User doesn't exist
      vi.mocked(prisma.taskList.findFirst).mockResolvedValue({ id: 'list-123', ownerId: 'test-user-id' } as any) // User has list access
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null) // No existing invitation
      vi.mocked(prisma.invitation.create).mockResolvedValue(mockInvitation as any)
      vi.mocked(sendInvitationEmail).mockResolvedValue(undefined)

      const request = new Request('http://localhost:3000/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invite@example.com',
          type: 'LIST_SHARING',
          listId: 'list-123',
          message: 'Join my list!',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.userExists).toBe(false)
      expect(data.invitation.email).toBe('invite@example.com')
      expect(data.invitation.type).toBe('LIST_SHARING')
      expect(prisma.invitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'invite@example.com',
            type: 'LIST_SHARING',
            senderId: 'test-user-id',
            listId: 'list-123',
            message: 'Join my list!',
            token: expect.stringMatching(/^inv_[a-f0-9]{32}$/),
          }),
          include: expect.objectContaining({
            sender: expect.objectContaining({
              select: expect.objectContaining({
                name: true,
                email: true,
              }),
            }),
          }),
        })
      )
    })

    it('should handle existing user for task assignment', async () => {
      const existingUser = {
        id: 'existing-user-123',
        name: 'Existing User',
        email: 'existing@example.com',
      }

      vi.mocked(prisma.user.findUnique).mockResolvedValue(existingUser as any)
      vi.mocked(prisma.task.findFirst).mockResolvedValue({ id: 'task-123', creatorId: 'test-user-id' } as any) // User has task access
      vi.mocked(prisma.task.update).mockResolvedValue(mockTask as any)

      const request = new Request('http://localhost:3000/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'existing@example.com',
          type: 'TASK_ASSIGNMENT',
          taskId: 'task-123',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.userExists).toBe(true)
      expect(data.assignedUser).toEqual(existingUser)
      expect(prisma.task.update).toHaveBeenCalledWith({
        where: { id: 'task-123' },
        data: { assigneeId: 'existing-user-123' },
      })
    })

    it('should reject duplicate invitations', async () => {
      const existingInvitation = {
        id: 'existing-invitation',
        email: 'invite@example.com',
        status: 'PENDING',
        type: 'LIST_SHARING',
        listId: 'list-123',
      }

      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.taskList.findFirst).mockResolvedValue({ id: 'list-123', ownerId: 'test-user-id' } as any) // User has list access
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(existingInvitation as any)

      const request = new Request('http://localhost:3000/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invite@example.com',
          type: 'LIST_SHARING',
          listId: 'list-123',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(409)
      expect(data.error).toBe('Invitation already sent for this email')
    })

    it('should require valid email', async () => {
      const request = new Request('http://localhost:3000/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: '',
          type: 'LIST_SHARING',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('Email is required')
    })

    it('should require authentication', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null)
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null)
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null)

      const request = new Request('http://localhost:3000/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          type: 'LIST_SHARING',
        }),
      })

      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  describe('GET - List invitations', () => {
    it('should list user invitations', async () => {
      const mockInvitations = [
        {
          id: 'invitation-1',
          email: 'user1@example.com',
          type: 'LIST_SHARING',
          sender: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
          receiver: null,
        },
        {
          id: 'invitation-2',
          email: 'user2@example.com',
          type: 'TASK_ASSIGNMENT',
          sender: { id: 'user-456', name: 'Other User', email: 'other@example.com' },
          receiver: { id: 'user-123', name: 'Test User', email: 'test@example.com' },
        },
      ]

      vi.mocked(prisma.invitation.findMany).mockResolvedValue(mockInvitations as any)

      const request = new Request('http://localhost:3000/api/invitations')
      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.invitations).toEqual(mockInvitations)
      expect(prisma.invitation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { senderId: 'test-user-id' },
              { receiverId: 'test-user-id' },
            ],
          },
          include: expect.objectContaining({
            sender: expect.objectContaining({
              select: expect.objectContaining({
                id: true,
                name: true,
                email: true,
              }),
            }),
            receiver: expect.objectContaining({
              select: expect.objectContaining({
                id: true,
                name: true,
                email: true,
              }),
            }),
          }),
          orderBy: { createdAt: "desc" },
        })
      )
    })
  })
})

describe('/api/invitations/[token]', () => {
  const mockInvitation = {
    id: 'invitation-123',
    email: 'invite@example.com',
    token: 'inv_1234567890_abcdef',
    type: 'LIST_SHARING',
    status: 'PENDING',
    senderId: 'user-456',
    listId: 'list-123',
    role: 'member',
    message: 'Join my list!',
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    sender: {
      name: 'Other User',
      email: 'other@example.com',
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET - Get invitation by token', () => {
    it('should return valid invitation', async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(mockInvitation as any)

      const response = await GetInvitation(
        new Request('http://localhost:3000/api/invitations/inv_1234567890_abcdef'),
        { params: { token: 'inv_1234567890_abcdef' } }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.invitation).toEqual({
        id: mockInvitation.id,
        emailHint: 'i***e@example.com',
        type: mockInvitation.type,
        sender: { name: mockInvitation.sender.name },
        expiresAt: mockInvitation.expiresAt.toISOString(),
      })
    })

    it('returns full invitation details only to the invitee', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: 'invitee-id', email: mockInvitation.email, name: 'Invitee' },
      } as any)
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(mockInvitation as any)

      const response = await GetInvitation(
        new Request('http://localhost:3000/api/invitations/inv_1234567890_abcdef'),
        { params: { token: 'inv_1234567890_abcdef' } }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.invitation).toMatchObject({
        email: mockInvitation.email,
        sender: mockInvitation.sender,
        message: mockInvitation.message,
      })
    })

    it('should return 404 for non-existent invitation', async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(null)

      const response = await GetInvitation(
        new Request('http://localhost:3000/api/invitations/invalid-token'),
        { params: { token: 'invalid-token' } }
      )
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Invitation not found')
    })

    it('should return 410 for expired invitation', async () => {
      const expiredInvitation = {
        ...mockInvitation,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
      }

      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(expiredInvitation as any)
      vi.mocked(prisma.invitation.update).mockResolvedValue(expiredInvitation as any)

      const response = await GetInvitation(
        new Request('http://localhost:3000/api/invitations/inv_expired'),
        { params: { token: 'inv_expired' } }
      )
      const data = await response.json()

      expect(response.status).toBe(410)
      expect(data.error).toBe('Invitation expired')
      expect(prisma.invitation.update).toHaveBeenCalledWith({
        where: { id: mockInvitation.id },
        data: { status: 'EXPIRED' },
      })
    })

    it('should return 410 for already processed invitation', async () => {
      const processedInvitation = {
        ...mockInvitation,
        status: 'ACCEPTED',
      }

      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(processedInvitation as any)

      const response = await GetInvitation(
        new Request('http://localhost:3000/api/invitations/inv_processed'),
        { params: { token: 'inv_processed' } }
      )
      const data = await response.json()

      expect(response.status).toBe(410)
      expect(data.error).toBe('Invitation already processed')
    })
  })

  describe('POST - Accept invitation', () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: 'test-user-id', email: 'invite@example.com', name: 'Test User' },
      } as any)
    })

    it('should accept valid list sharing invitation', async () => {
      const transactionMock = vi.fn().mockImplementation((callback) => callback({
        invitation: {
          update: vi.fn().mockResolvedValue(mockInvitation),
        },
        listMember: {
          upsert: vi.fn().mockResolvedValue({
            id: 'lm-123',
            listId: 'list-123',
            userId: 'user-123',
            role: 'member'
          }),
        },
        taskList: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'list-123',
            owner: { id: 'owner-123' },
            listMembers: [{ userId: 'user-123', role: 'member', user: { id: 'user-123' } }],
          }),
        },
      }))

      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(mockInvitation as any)
      vi.mocked(prisma.$transaction).mockImplementation(transactionMock)

      const response = await AcceptInvitation(
        new Request('http://localhost:3000/api/invitations/inv_1234567890_abcdef', { method: 'POST' }),
        { params: { token: 'inv_1234567890_abcdef' } }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message).toBe('Invitation accepted successfully')
    })

    it('should require authentication', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null)

      const response = await AcceptInvitation(
        new Request('http://localhost:3000/api/invitations/inv_1234567890_abcdef', { method: 'POST' }),
        { params: { token: 'inv_1234567890_abcdef' } }
      )
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Must be logged in to accept invitation')
    })

    it('should require email match', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: 'test-user-id', email: 'wrong@example.com', name: 'Test User' },
      } as any)
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(mockInvitation as any)

      const response = await AcceptInvitation(
        new Request('http://localhost:3000/api/invitations/inv_1234567890_abcdef', { method: 'POST' }),
        { params: { token: 'inv_1234567890_abcdef' } }
      )
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.error).toBe('Email mismatch. Please sign in with the invited email address.')
    })
  })

  describe('DELETE - Decline invitation', () => {
    it('should decline valid invitation', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: 'invitee-id', email: mockInvitation.email, name: 'Invitee' },
      } as any)
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(mockInvitation as any)
      vi.mocked(prisma.invitation.update).mockResolvedValue({
        ...mockInvitation,
        status: 'DECLINED',
      } as any)

      const response = await DeclineInvitation(
        new Request('http://localhost:3000/api/invitations/inv_1234567890_abcdef', { method: 'DELETE' }),
        { params: { token: 'inv_1234567890_abcdef' } }
      )
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.success).toBe(true)
      expect(data.message).toBe('Invitation declined')
      expect(prisma.invitation.update).toHaveBeenCalledWith({
        where: { id: mockInvitation.id },
        data: { status: 'DECLINED' },
      })
    })

    it('should require authentication', async () => {
      vi.mocked(getServerSession).mockResolvedValue(null)

      const response = await DeclineInvitation(
        new Request('http://localhost:3000/api/invitations/inv_1234567890_abcdef', { method: 'DELETE' }),
        { params: { token: 'inv_1234567890_abcdef' } }
      )

      expect(response.status).toBe(401)
      expect(prisma.invitation.findUnique).not.toHaveBeenCalled()
    })

    it('allows the sender to decline an invitation', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: mockInvitation.senderId, email: 'sender@example.com', name: 'Sender' },
      } as any)
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(mockInvitation as any)
      vi.mocked(prisma.invitation.update).mockResolvedValue({
        ...mockInvitation,
        status: 'DECLINED',
      } as any)

      const response = await DeclineInvitation(
        new Request('http://localhost:3000/api/invitations/inv_1234567890_abcdef', { method: 'DELETE' }),
        { params: { token: 'inv_1234567890_abcdef' } }
      )

      expect(response.status).toBe(200)
    })

    it('denies unrelated users', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { id: 'unrelated-id', email: 'unrelated@example.com', name: 'Unrelated' },
      } as any)
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(mockInvitation as any)

      const response = await DeclineInvitation(
        new Request('http://localhost:3000/api/invitations/inv_1234567890_abcdef', { method: 'DELETE' }),
        { params: { token: 'inv_1234567890_abcdef' } }
      )

      expect(response.status).toBe(403)
      expect(prisma.invitation.update).not.toHaveBeenCalled()
    })

    it('should return 404 for non-existent invitation', async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(null)

      const response = await DeclineInvitation(
        new Request('http://localhost:3000/api/invitations/invalid-token', { method: 'DELETE' }),
        { params: { token: 'invalid-token' } }
      )
      const data = await response.json()

      expect(response.status).toBe(404)
      expect(data.error).toBe('Invitation not found')
    })

    it('should return 410 for already processed invitation', async () => {
      const processedInvitation = {
        ...mockInvitation,
        status: 'ACCEPTED',
      }

      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(processedInvitation as any)

      const response = await DeclineInvitation(
        new Request('http://localhost:3000/api/invitations/inv_processed', { method: 'DELETE' }),
        { params: { token: 'inv_processed' } }
      )
      const data = await response.json()

      expect(response.status).toBe(410)
      expect(data.error).toBe('Invitation already processed')
    })
  })
})