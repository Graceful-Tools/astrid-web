import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    addressBookContact: {
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {
    constructor(msg = 'Unauthorized') { super(msg); this.name = 'UnauthorizedError' }
  }
  class ForbiddenError extends Error {
    constructor(msg = 'Forbidden') { super(msg); this.name = 'ForbiddenError' }
  }
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

vi.mock('@/lib/field-encryption', () => ({
  encryptField: vi.fn((value: string) => `enc(${value})`),
  decryptField: vi.fn((value: string | null) => {
    if (!value) return null
    if (value.startsWith('enc(') && value.endsWith(')')) return value.slice(4, -1)
    return value
  }),
}))

import { GET, POST, DELETE } from '@/app/api/v1/contacts/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const authedUser = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['contacts:read', 'contacts:write'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/v1/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 400 when contacts is not an array', async () => {
    const res = await POST(
      makeReq('POST', 'http://localhost/api/v1/contacts', { contacts: 'oops' }),
      undefined as any
    )
    expect(res.status).toBe(400)
  })

  it('skips invalid emails and reports errors', async () => {
    const txMock = mockPrisma.$transaction as any
    txMock.mockImplementation(async (cb: any) => {
      const tx = {
        addressBookContact: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          findMany: vi.fn().mockResolvedValue([]),
          createMany: vi.fn().mockResolvedValue({ count: 1 }),
          update: vi.fn(),
          count: vi.fn().mockResolvedValue(1),
        },
      }
      return cb(tx)
    })

    const res = await POST(
      makeReq('POST', 'http://localhost/api/v1/contacts', {
        contacts: [
          { email: 'good@example.com', name: 'Good' },
          { email: 'no-at-symbol' },
          { name: 'no-email' },
        ],
      }),
      undefined as any
    )

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.stats.received).toBe(3)
    expect(json.stats.valid).toBe(1)
    expect(json.stats.errors).toBe(2)
    expect(json.errors).toHaveLength(2)
  })

  it('encrypts name and phone before persisting', async () => {
    const createManyMock = vi.fn().mockResolvedValue({ count: 1 })
    const txMock = mockPrisma.$transaction as any
    txMock.mockImplementation(async (cb: any) => {
      const tx = {
        addressBookContact: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          findMany: vi.fn().mockResolvedValue([]),
          createMany: createManyMock,
          update: vi.fn(),
          count: vi.fn().mockResolvedValue(1),
        },
      }
      return cb(tx)
    })

    await POST(
      makeReq('POST', 'http://localhost/api/v1/contacts', {
        contacts: [{ email: 'a@b.com', name: 'Alice', phoneNumber: '555-0100' }],
      }),
      undefined as any
    )

    expect(createManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            email: 'a@b.com',
            name: 'enc(Alice)',
            phoneNumber: 'enc(555-0100)',
          }),
        ],
      })
    )
  })

  it('dedupes contacts by email (last one wins)', async () => {
    const createManyMock = vi.fn().mockResolvedValue({ count: 1 })
    const txMock = mockPrisma.$transaction as any
    txMock.mockImplementation(async (cb: any) => {
      const tx = {
        addressBookContact: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
          findMany: vi.fn().mockResolvedValue([]),
          createMany: createManyMock,
          update: vi.fn(),
          count: vi.fn().mockResolvedValue(1),
        },
      }
      return cb(tx)
    })

    await POST(
      makeReq('POST', 'http://localhost/api/v1/contacts', {
        contacts: [
          { email: 'a@b.com', name: 'First' },
          { email: 'a@b.com', name: 'Second' },
        ],
      }),
      undefined as any
    )

    const createCall = createManyMock.mock.calls[0][0]
    expect(createCall.data).toHaveLength(1)
    expect(createCall.data[0].name).toBe('enc(Second)')
  })

  it('updates existing contacts when replaceAll=false', async () => {
    const updateMock = vi.fn().mockResolvedValue({})
    const findManyTx = vi.fn().mockResolvedValue([{ id: 'existing-1', email: 'a@b.com' }])
    const deleteManyTx = vi.fn()
    const createManyTx = vi.fn().mockResolvedValue({ count: 0 })

    const txMock = mockPrisma.$transaction as any
    txMock.mockImplementation(async (cb: any) => {
      const tx = {
        addressBookContact: {
          deleteMany: deleteManyTx,
          findMany: findManyTx,
          createMany: createManyTx,
          update: updateMock,
          count: vi.fn().mockResolvedValue(1),
        },
      }
      return cb(tx)
    })

    const res = await POST(
      makeReq('POST', 'http://localhost/api/v1/contacts', {
        replaceAll: false,
        contacts: [{ email: 'a@b.com', name: 'Updated' }],
      }),
      undefined as any
    )

    expect(res.status).toBe(200)
    expect(deleteManyTx).not.toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'existing-1' } })
    )
  })
})

describe('GET /api/v1/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns decrypted contacts and pagination', async () => {
    ;(mockPrisma.addressBookContact.findMany as any).mockResolvedValue([
      {
        id: 'c-1',
        email: 'a@b.com',
        name: 'enc(Alice)',
        phoneNumber: 'enc(555)',
        uploadedAt: new Date('2026-01-01'),
      },
    ])
    ;(mockPrisma.addressBookContact.count as any).mockResolvedValue(1)

    const res = await GET(
      makeReq('GET', 'http://localhost/api/v1/contacts?limit=50&offset=0'),
      undefined as any
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.contacts[0].name).toBe('Alice')
    expect(json.contacts[0].phoneNumber).toBe('555')
    expect(json.pagination).toMatchObject({ total: 1, limit: 50, offset: 0, hasMore: false })
  })

  it('caps limit at 500', async () => {
    ;(mockPrisma.addressBookContact.findMany as any).mockResolvedValue([])
    ;(mockPrisma.addressBookContact.count as any).mockResolvedValue(0)

    await GET(
      makeReq('GET', 'http://localhost/api/v1/contacts?limit=10000'),
      undefined as any
    )

    const call = (mockPrisma.addressBookContact.findMany as any).mock.calls[0][0]
    expect(call.take).toBe(500)
  })

  it('reports hasMore=true when offset+contacts < total', async () => {
    ;(mockPrisma.addressBookContact.findMany as any).mockResolvedValue([
      { id: 'c-1', email: 'a@b.com', name: null, phoneNumber: null, uploadedAt: new Date() },
    ])
    ;(mockPrisma.addressBookContact.count as any).mockResolvedValue(50)

    const res = await GET(
      makeReq('GET', 'http://localhost/api/v1/contacts?limit=1&offset=0'),
      undefined as any
    )
    const json = await res.json()
    expect(json.pagination.hasMore).toBe(true)
  })
})

describe('DELETE /api/v1/contacts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('deletes all contacts for the caller', async () => {
    ;(mockPrisma.addressBookContact.deleteMany as any).mockResolvedValue({ count: 12 })
    const res = await DELETE(
      makeReq('DELETE', 'http://localhost/api/v1/contacts'),
      undefined as any
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.deleted).toBe(12)
    expect(mockPrisma.addressBookContact.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    })
  })
})
