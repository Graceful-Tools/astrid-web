import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '@/app/api/lists/[id]/leave/route'
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
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    listInvite: {
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

const mockPrisma = prisma as any
const mockGetServerSession = getServerSession as any

const mockSession = {
  user: {
    id: 'user-2',
    email: 'member@example.com',
    name: 'Member User',
  },
}

const mockList = {
  id: 'list-1',
  name: 'Test List',
  ownerId: 'user-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(mockSession)
})

describe('POST /api/lists/[id]/leave', () => {
  it('allows regular member to leave list', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst.mockResolvedValue({
      id: 'member-1',
      userId: 'user-2',
      listId: 'list-1',
      role: 'member',
    })
    mockPrisma.listMember.deleteMany.mockResolvedValue({ count: 1 })
    mockPrisma.listInvite.deleteMany.mockResolvedValue({})

    const request = new Request('http://localhost/api/lists/list-1/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Successfully left the list')
    expect(mockPrisma.listMember.deleteMany).toHaveBeenCalledWith({
      where: {
        listId: 'list-1',
        userId: 'user-2',
      },
    })
    expect(mockPrisma.listInvite.deleteMany).toHaveBeenCalledWith({
      where: {
        listId: 'list-1',
        email: 'member@example.com',
      },
    })
  })

  it('allows admin to leave if there are other admins', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce({
        id: 'member-1',
        userId: 'user-2',
        listId: 'list-1',
        role: 'admin',
      })
      .mockResolvedValueOnce(null) // ownerIsAdmin check
    mockPrisma.listMember.count.mockResolvedValue(2) // 2 total admins
    mockPrisma.listMember.deleteMany.mockResolvedValue({ count: 1 })
    mockPrisma.listInvite.deleteMany.mockResolvedValue({})

    const request = new Request('http://localhost/api/lists/list-1/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Successfully left the list')
  })

  it('prevents last admin from leaving', async () => {
    // Test with user who is both the owner AND the only admin
    const ownerAdminSession = {
      user: {
        id: 'user-1', // same as owner
        email: 'owner@example.com',
        name: 'Owner User',
      },
    }
    mockGetServerSession.mockResolvedValue(ownerAdminSession)

    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce({
        id: 'member-1',
        userId: 'user-1',
        listId: 'list-1',
        role: 'admin',
      })
      .mockResolvedValueOnce({
        id: 'member-1',
        userId: 'user-1',
        role: 'admin'
      }) // ownerIsAdmin check finds the owner as admin
    mockPrisma.listMember.count.mockResolvedValue(1) // only 1 admin (the owner)
    
    // totalAdmins = 1 (admin count) + 0 (owner already counted) = 1

    const request = new Request('http://localhost/api/lists/list-1/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe(
      'Cannot leave as the last admin. Either promote another member to admin or delete the list.'
    )
    expect(data.isLastAdmin).toBe(true)
  })

  it('allows owner to leave if there are other admins', async () => {
    const ownerSession = {
      user: {
        id: 'user-1', // owner
        email: 'owner@example.com',
        name: 'Owner User',
      },
    }
    mockGetServerSession.mockResolvedValue(ownerSession)

    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce({
        id: 'member-1',
        userId: 'user-1',
        listId: 'list-1',
        role: 'admin',
      })
      .mockResolvedValueOnce({
        userId: 'user-1',
        role: 'admin',
      }) // ownerIsAdmin check
    mockPrisma.listMember.count.mockResolvedValue(2) // 2 total admins
    mockPrisma.listMember.deleteMany.mockResolvedValue({ count: 1 })
    mockPrisma.listInvite.deleteMany.mockResolvedValue({})

    const request = new Request('http://localhost/api/lists/list-1/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Successfully left the list')
  })

  it('prevents owner from leaving if they are the only admin', async () => {
    const ownerSession = {
      user: {
        id: 'user-1', // owner
        email: 'owner@example.com',
        name: 'Owner User',
      },
    }
    mockGetServerSession.mockResolvedValue(ownerSession)

    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce({
        id: 'member-1',
        userId: 'user-1',
        listId: 'list-1',
        role: 'admin',
      })
      .mockResolvedValueOnce({
        userId: 'user-1',
        role: 'admin',
      }) // ownerIsAdmin check
    mockPrisma.listMember.count.mockResolvedValue(1) // only 1 admin total

    const request = new Request('http://localhost/api/lists/list-1/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe(
      'Cannot leave as the last admin. Either promote another member to admin or delete the list.'
    )
  })

  it('returns 404 if user is not a member', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst.mockResolvedValue(null)

    const request = new Request('http://localhost/api/lists/list-1/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('You are not a member of this list')
  })

  it('returns 404 if list does not exist', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(null)

    const request = new Request('http://localhost/api/lists/list-1/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('List not found')
  })

  it('returns 404 if user left but no member record existed', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst.mockResolvedValue({
      id: 'member-1',
      userId: 'user-2',
      listId: 'list-1',
      role: 'member',
    })
    mockPrisma.listMember.deleteMany.mockResolvedValue({ count: 0 }) // No records deleted

    const request = new Request('http://localhost/api/lists/list-1/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('You are not a member of this list')
  })

  it('returns 401 for unauthenticated users', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/lists/list-1/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })

    expect(response.status).toBe(401)
  })

  it('handles admin count calculation with owner not in members table', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce({
        id: 'member-1',
        userId: 'user-2',
        listId: 'list-1',
        role: 'admin',
      })
      .mockResolvedValueOnce(null) // owner not in ListMember table
    mockPrisma.listMember.count.mockResolvedValue(1) // 1 admin in table
    // Total should be 2 (1 in table + 1 owner), so user can leave
    mockPrisma.listMember.deleteMany.mockResolvedValue({ count: 1 })
    mockPrisma.listInvite.deleteMany.mockResolvedValue({})

    const request = new Request('http://localhost/api/lists/list-1/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Successfully left the list')
  })
})