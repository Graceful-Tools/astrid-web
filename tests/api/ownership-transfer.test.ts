import { describe, it, expect, beforeEach, vi } from 'vitest'
import { POST } from '@/app/api/lists/[id]/transfer-ownership/route'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    listMember: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}))

const mockPrisma = prisma as any
const mockGetServerSession = getServerSession as any

const mockOwnerSession = {
  user: {
    id: 'owner-id',
    email: 'owner@example.com',
    name: 'List Owner',
  },
}

const mockList = {
  id: 'list-1',
  ownerId: 'owner-id',
}

const mockNewOwnerMember = {
  id: 'member-1',
  userId: 'new-owner-id',
  listId: 'list-1',
  role: 'admin',
}

const mockOldOwnerMembership = {
  id: 'member-2',
  userId: 'owner-id',
  listId: 'list-1',
  role: 'admin',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetServerSession.mockResolvedValue(mockOwnerSession)
})

describe('POST /api/lists/[id]/transfer-ownership', () => {
  it('successfully transfers ownership and removes old owner from all access paths', async () => {
    // Setup mocks
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce(mockNewOwnerMember) // New owner member check
      .mockResolvedValueOnce(mockOldOwnerMembership) // Old owner membership check
    
    // Mock the transaction
    const mockTx = {
      taskList: {
        update: vi.fn(),
      },
      listMember: {
        delete: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(mockOldOwnerMembership),
      },
    }
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      return callback(mockTx)
    })

    const request = new Request('http://localhost/api/lists/list-1/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwnerId: 'new-owner-id' }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Ownership transferred successfully')

    // Verify transaction was called
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)

    // Verify all operations within the transaction
    // 1. Transfer ownership (single update to change ownerId)
    expect(mockTx.taskList.update).toHaveBeenCalledTimes(1)
    expect(mockTx.taskList.update).toHaveBeenCalledWith({
      where: { id: 'list-1' },
      data: { ownerId: 'new-owner-id' },
    })

    // 2. Remove new owner from listMembers (since they're now the owner)
    expect(mockTx.listMember.delete).toHaveBeenNthCalledWith(1, {
      where: { id: mockNewOwnerMember.id },
    })

    // 3. Remove old owner from listMembers
    expect(mockTx.listMember.delete).toHaveBeenNthCalledWith(2, {
      where: { id: mockOldOwnerMembership.id },
    })
  })

  it('successfully transfers ownership when old owner has no listMember record', async () => {
    // Setup mocks - old owner not in listMembers table
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce(mockNewOwnerMember) // New owner member check
      .mockResolvedValueOnce(null) // Old owner has no listMember record
    
    // Mock the transaction
    const mockTx = {
      taskList: {
        update: vi.fn(),
      },
      listMember: {
        delete: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(null), // No old owner membership found
      },
    }
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      return callback(mockTx)
    })

    const request = new Request('http://localhost/api/lists/list-1/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwnerId: 'new-owner-id' }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Ownership transferred successfully')

    // Should transfer ownership and remove new owner from listMembers
    expect(mockTx.taskList.update).toHaveBeenCalledTimes(1)
    expect(mockTx.listMember.delete).toHaveBeenCalledTimes(1) // Only new owner removal (old owner had no listMember record)
  })

  it('returns 401 for unauthenticated users', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const request = new Request('http://localhost/api/lists/list-1/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwnerId: 'new-owner-id' }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data.error).toBe('Unauthorized')
  })

  it('returns 400 when newOwnerId is missing', async () => {
    const request = new Request('http://localhost/api/lists/list-1/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('New owner ID is required')
  })

  it('returns 404 when list does not exist', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(null)

    const request = new Request('http://localhost/api/lists/list-1/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwnerId: 'new-owner-id' }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(404)
    expect(data.error).toBe('List not found')
  })

  it('returns 403 when user is not the owner', async () => {
    const nonOwnerSession = {
      user: {
        id: 'non-owner-id',
        email: 'nonowner@example.com',
        name: 'Non Owner',
      },
    }
    mockGetServerSession.mockResolvedValue(nonOwnerSession)
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)

    const request = new Request('http://localhost/api/lists/list-1/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwnerId: 'new-owner-id' }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Only the owner can transfer ownership')
  })

  it('returns 400 when new owner is not a member of the list', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    // Clear any previous mocks and explicitly set to return null
    mockPrisma.listMember.findFirst.mockReset()
    mockPrisma.listMember.findFirst.mockResolvedValue(null) // New owner not found as member

    const request = new Request('http://localhost/api/lists/list-1/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwnerId: 'non-member-id' }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('New owner must be a current member of the list')
  })

  it('returns 500 when database transaction fails', async () => {
    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst.mockReset()
    mockPrisma.listMember.findFirst.mockResolvedValue(mockNewOwnerMember) // New owner member check passes
    mockPrisma.$transaction.mockReset()
    mockPrisma.$transaction.mockRejectedValue(new Error('Database error'))

    const request = new Request('http://localhost/api/lists/list-1/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwnerId: 'new-owner-id' }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to transfer ownership')
  })

  it('handles transfer when new owner is a regular member (not admin)', async () => {
    const regularMember = {
      id: 'member-1',
      userId: 'new-owner-id',
      listId: 'list-1',
      role: 'member', // Regular member, not admin
    }

    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst
      .mockResolvedValueOnce(regularMember) // New owner member check
      .mockResolvedValueOnce(mockOldOwnerMembership) // Old owner membership check
    
    // Mock the transaction
    const mockTx = {
      taskList: {
        update: vi.fn(),
      },
      listMember: {
        delete: vi.fn(),
        findFirst: vi.fn().mockResolvedValue(mockOldOwnerMembership),
      },
    }
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      return callback(mockTx)
    })

    const request = new Request('http://localhost/api/lists/list-1/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwnerId: 'new-owner-id' }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.message).toBe('Ownership transferred successfully')

    // Should still work for regular members who will become owners
    expect(mockTx.listMember.delete).toHaveBeenNthCalledWith(1, {
      where: { id: regularMember.id },
    })
  })

  it('handles edge case where owner tries to transfer to themselves', async () => {
    // Owner trying to transfer to themselves
    const selfTransferMember = {
      id: 'member-1',
      userId: 'owner-id', // Same as current owner
      listId: 'list-1',
      role: 'admin',
    }

    mockPrisma.taskList.findUnique.mockResolvedValue(mockList)
    mockPrisma.listMember.findFirst.mockResolvedValue(selfTransferMember)
    
    const request = new Request('http://localhost/api/lists/list-1/transfer-ownership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newOwnerId: 'owner-id' }),
    })
    const params = { id: 'list-1' }

    const response = await POST(request, { params })
    
    // This should still work technically, though it's a no-op
    expect(response.status).toBe(200)
  })
})