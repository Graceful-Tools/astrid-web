import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GET, POST, DELETE, PATCH } from '@/app/api/lists/[id]/members/route'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findUnique: vi.fn(),
    },
    listMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    invitation: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    listInvite: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendListInvitationEmail: vi.fn(),
}))

vi.mock('crypto', () => ({
  default: {
    randomBytes: vi.fn(() => ({
      toString: vi.fn(() => 'mock-token-123'),
    })),
  },
  randomBytes: vi.fn(() => ({
    toString: vi.fn(() => 'mock-token-123'),
  })),
}))

const mockPrisma = prisma as any
const mockGetServerSession = getServerSession as any

const mockSession = {
  user: {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
  },
}

const mockList = {
  id: 'list-1',
  name: 'Test List',
  ownerId: 'user-1',
}

const mockMembers = [
  {
    id: 'member-1',
    userId: 'user-1',
    listId: 'list-1',
    role: 'admin',
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
    },
  },
  {
    id: 'member-2',
    userId: 'user-2',
    listId: 'list-1',
    role: 'member',
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: 'user-2',
      name: 'Jane Doe',
      email: 'jane@example.com',
    },
  },
]

const mockInvites = [
  {
    id: 'invite-1',
    listId: 'list-1',
    email: 'pending@example.com',
    role: 'member',
    token: 'invite-token',
    createdAt: new Date(),
    updatedAt: new Date(),
    creator: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
    },
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(mockSession)
})

describe('GET /api/lists/[id]/members', () => {
  it('returns members and invites for list admin', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst.mockResolvedValue({ role: 'admin' })
    mockPrisma.listMember.findMany.mockResolvedValue(mockMembers)
    mockPrisma.invitation.findMany.mockResolvedValue(mockInvites)

    const request = new Request('http://localhost/api/lists/list-1/members')
    const params = { id: 'list-1' }

    const response = await GET(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.members).toHaveLength(3) // 2 members + 1 invite
    expect(data.user_role).toBe('admin')

    // Verify member structure
    const memberData = data.members.find((m: any) => m.type === 'member')
    expect(memberData).toMatchObject({
      user_id: 'user-1',
      role: 'admin',
      email: 'test@example.com',
      type: 'member',
    })

    // Verify invite structure
    const inviteData = data.members.find((m: any) => m.type === 'invite')
    expect(inviteData).toMatchObject({
      email: 'pending@example.com',
      role: 'member',
      type: 'invite',
    })
  })

  it('returns members for regular member', async () => {
    const regularUserSession = {
      user: {
        id: 'user-2',
        email: 'jane@example.com',
        name: 'Jane Doe',
      },
    }
    mockGetServerSession.mockResolvedValue(regularUserSession)
    
    const regularMemberList = { ...mockList, ownerId: 'user-1' } // Different owner
    mockPrisma.taskList.findUnique
      .mockResolvedValueOnce(regularMemberList) // First call in permission check
      .mockResolvedValueOnce(regularMemberList) // Second call in isListAdmin
    
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce({ role: 'member', userId: 'user-2' }) // isMember check
      .mockResolvedValueOnce(null) // isAdmin check (not admin)
    
    mockPrisma.listMember.findMany.mockResolvedValue(mockMembers)
    mockPrisma.invitation.findMany.mockResolvedValue(mockInvites)

    const request = new Request('http://localhost/api/lists/list-1/members')
    const params = { id: 'list-1' }

    const response = await GET(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.user_role).toBe('member')
  })

  it('returns 403 for non-members', async () => {
    const nonMemberSession = {
      user: {
        id: 'user-3',
        email: 'outsider@example.com',
        name: 'Outsider',
      },
    }
    mockGetServerSession.mockResolvedValue(nonMemberSession)
    
    const otherOwnerList = { ...mockList, ownerId: 'user-1' } // Different owner
    mockPrisma.taskList.findUnique
      .mockResolvedValueOnce(otherOwnerList) // First call in permission check
      .mockResolvedValueOnce(otherOwnerList) // Second call in isListAdmin
      
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce(null) // Not a member
      .mockResolvedValueOnce(null) // Not an admin either

    const request = new Request('http://localhost/api/lists/list-1/members')
    const params = { id: 'list-1' }

    const response = await GET(request, { params })

    expect(response.status).toBe(403)
  })

  it('returns 401 for unauthenticated users', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/lists/list-1/members')
    const params = { id: 'list-1' }

    const response = await GET(request, { params })

    expect(response.status).toBe(401)
  })
})

describe('POST /api/lists/[id]/members', () => {
  it('adds existing user as member immediately', async () => {
    // Setup admin user session (list owner)
    mockGetServerSession.mockResolvedValue(mockSession)
    
    // Mock isListAdmin calls - owner check succeeds
    mockPrisma.taskList.findUnique
      .mockResolvedValueOnce(mockList) // isListAdmin owner check
      .mockResolvedValueOnce(mockList) // list details
    
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-2',
      email: 'existing@example.com',
    })
    
    // No existing member
    mockPrisma.listMember.findFirst.mockResolvedValue(null)
    
    mockPrisma.listMember.create.mockResolvedValue({
      id: 'new-member',
      listId: 'list-1',
      userId: 'user-2',
      role: 'member',
    })
    
    mockPrisma.invitation.create.mockResolvedValue({})

    const request = new Request('http://localhost/api/lists/list-1/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'existing@example.com',
        role: 'member',
      }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.message).toBe('Member added and invitation sent successfully')
    expect(mockPrisma.listMember.create).toHaveBeenCalledWith({
      data: {
        listId: 'list-1',
        userId: 'user-2',
        role: 'member',
      },
    })
  })

  it('creates invite for new user', async () => {
    // Setup admin session (owner)
    mockGetServerSession.mockResolvedValue(mockSession)
    
    // Mock isListAdmin calls - owner succeeds
    mockPrisma.taskList.findUnique
      .mockResolvedValueOnce(mockList) // isListAdmin owner check
      .mockResolvedValueOnce(mockList) // list details
      
    mockPrisma.user.findUnique.mockResolvedValue(null) // New user
    mockPrisma.invitation.create.mockResolvedValue({})

    const request = new Request('http://localhost/api/lists/list-1/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'newuser@example.com',
        role: 'member',
      }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.success).toBe(true)
    expect(data.message).toBe('Invitation sent successfully')
    expect(mockPrisma.invitation.create).toHaveBeenCalled()
  })

  it('returns 403 for non-admin users', async () => {
    // Setup non-admin user session
    const regularUserSession = {
      user: {
        id: 'user-2',
        email: 'jane@example.com',
        name: 'Jane Doe',
      },
    }
    mockGetServerSession.mockResolvedValue(regularUserSession)
    
    // Mock isListAdmin calls - not owner, not admin
    const otherOwnerList = { ...mockList, ownerId: 'user-1' }
    mockPrisma.taskList.findUnique.mockResolvedValue(otherOwnerList)
    mockPrisma.listMember.findFirst.mockResolvedValue(null) // Not admin member

    const request = new Request('http://localhost/api/lists/list-1/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'test@example.com',
        role: 'member',
      }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })

    expect(response.status).toBe(403)
  })
})

describe('DELETE /api/lists/[id]/members', () => {
  it('removes member successfully', async () => {
    // Setup admin session (owner)
    mockGetServerSession.mockResolvedValue(mockSession)
    
    // Mock isListAdmin calls - owner succeeds
    mockPrisma.taskList.findUnique
      .mockResolvedValueOnce(mockList) // isListAdmin owner check  
      .mockResolvedValueOnce(mockList) // member to remove lookup
      .mockResolvedValueOnce(mockList) // default assignee check
      
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce({ role: 'member', userId: 'user-2' }) // member to remove
      
    mockPrisma.listMember.count.mockResolvedValue(2) // admin count
    mockPrisma.listMember.deleteMany.mockResolvedValue({ count: 1 })
    mockPrisma.user.findUnique.mockResolvedValue({ email: 'jane@example.com' })
    mockPrisma.listInvite.deleteMany.mockResolvedValue({})

    const request = new Request('http://localhost/api/lists/list-1/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: 'user-2',
      }),
    })
    const params = { id: 'list-1' }

    const response = await DELETE(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Member removed successfully')
    expect(mockPrisma.listMember.deleteMany).toHaveBeenCalledWith({
      where: {
        listId: 'list-1',
        userId: 'user-2',
      },
    })
  })

  it('prevents removing last admin', async () => {
    // Setup session for admin user being removed
    mockGetServerSession.mockResolvedValue(mockSession)
    
    // Mock isListAdmin calls - owner succeeds
    mockPrisma.taskList.findUnique
      .mockResolvedValueOnce(mockList) // isListAdmin owner check
      .mockResolvedValueOnce(mockList) // admin count check
      
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce({ role: 'admin', userId: 'user-1' }) // member to remove is admin
      
    mockPrisma.listMember.count.mockResolvedValue(0) // 0 other admin members
    // Total admins = 0 (members) + 1 (owner) = 1, so removing would leave 0

    const request = new Request('http://localhost/api/lists/list-1/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: 'user-1',
      }),
    })
    const params = { id: 'list-1' }

    const response = await DELETE(request, { params })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot remove the last admin')
  })

  it('cancels invitation successfully', async () => {
    // Setup admin session (owner)
    mockGetServerSession.mockResolvedValue(mockSession)
    
    // Mock isListAdmin calls - owner succeeds
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    
    mockPrisma.listInvite.deleteMany.mockResolvedValue({ count: 1 })

    const request = new Request('http://localhost/api/lists/list-1/members', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pending@example.com',
        isInvitation: true,
      }),
    })
    const params = { id: 'list-1' }

    const response = await DELETE(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Invitation cancelled successfully')
  })
})

describe('PATCH /api/lists/[id]/members', () => {
  it('updates member role successfully', async () => {
    // Setup admin session (owner)
    mockGetServerSession.mockResolvedValue(mockSession)
    
    // Mock isListAdmin calls - owner succeeds
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    
    mockPrisma.listMember.updateMany.mockResolvedValue({ count: 1 })

    const request = new Request('http://localhost/api/lists/list-1/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: 'user-2',
        role: 'admin',
      }),
    })
    const params = { id: 'list-1' }

    const response = await PATCH(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Member role updated successfully')
    expect(mockPrisma.listMember.updateMany).toHaveBeenCalledWith({
      where: {
        listId: 'list-1',
        userId: 'user-2',
      },
      data: { role: 'admin' },
    })
  })

  it('updates invitation role successfully', async () => {
    // Setup admin session (owner)
    mockGetServerSession.mockResolvedValue(mockSession)
    
    // Mock isListAdmin calls - owner succeeds
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    
    mockPrisma.listInvite.updateMany.mockResolvedValue({ count: 1 })

    const request = new Request('http://localhost/api/lists/list-1/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'pending@example.com',
        role: 'admin',
        isInvitation: true,
      }),
    })
    const params = { id: 'list-1' }

    const response = await PATCH(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Invitation role updated successfully')
  })

  it('prevents demoting last admin', async () => {
    // Setup session for admin user (not the owner)
    const adminUserSession = {
      user: {
        id: 'user-2',
        email: 'admin@example.com', 
        name: 'Admin User',
      },
    }
    mockGetServerSession.mockResolvedValue(adminUserSession)
    
    // Create list with no owner or different owner
    const listWithoutOwner = { ...mockList, ownerId: null }
    
    // Mock isListAdmin calls - user-2 is admin member (not owner)
    mockPrisma.taskList.findUnique
      .mockResolvedValueOnce(listWithoutOwner) // isListAdmin owner check fails
      .mockResolvedValueOnce(listWithoutOwner) // admin count check
      .mockResolvedValueOnce(listWithoutOwner) // final check
      
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce({ role: 'admin', userId: 'user-2' }) // isListAdmin member check succeeds
      .mockResolvedValueOnce({ role: 'admin', userId: 'user-2' }) // member to update is admin
      
    // Only 1 admin member total, no owner
    mockPrisma.listMember.count.mockResolvedValue(1) // 1 admin member total
    
    // totalAdmins = 1 (member) + 0 (no owner) = 1, so totalAdmins <= 1 should block this

    const request = new Request('http://localhost/api/lists/list-1/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: 'user-2',
        role: 'member',
      }),
    })
    const params = { id: 'list-1' }

    const response = await PATCH(request, { params })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot remove the last admin')
  })

  it('returns 403 for non-admin users', async () => {
    // Setup non-admin user session
    const regularUserSession = {
      user: {
        id: 'user-2',
        email: 'jane@example.com',
        name: 'Jane Doe',
      },
    }
    mockGetServerSession.mockResolvedValue(regularUserSession)
    
    // Mock isListAdmin calls - not owner, not admin
    const otherOwnerList = { ...mockList, ownerId: 'user-1' }
    mockPrisma.taskList.findUnique.mockResolvedValue(otherOwnerList)
    mockPrisma.listMember.findFirst.mockResolvedValue(null) // Not admin member

    const request = new Request('http://localhost/api/lists/list-1/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        memberId: 'user-2',
        role: 'admin',
      }),
    })
    const params = { id: 'list-1' }

    const response = await PATCH(request, { params })

    expect(response.status).toBe(403)
  })
})