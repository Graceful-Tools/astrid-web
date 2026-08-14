import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: {
      findUnique: vi.fn(),
    },
    listMember: {
      create: vi.fn(),
    },
    invitation: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    listInvite: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
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

vi.mock('@/lib/sse-utils', () => ({
  broadcastToUsers: vi.fn(),
}))

vi.mock('@/lib/email', () => ({
  sendListInvitationEmail: vi.fn().mockResolvedValue(undefined),
}))

import { GET, POST } from '@/app/api/v1/lists/[id]/members/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { sendListInvitationEmail } from '@/lib/email'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)
const mockSendInvitation = vi.mocked(sendListInvitationEmail)

const ownerAuth = {
  userId: 'owner-1',
  source: 'oauth' as const,
  scopes: ['lists:read', 'lists:write'],
  isAIAgent: false,
  user: { id: 'owner-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(method: 'GET' | 'POST', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/lists/list-1/members', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const params = Promise.resolve({ id: 'list-1' })

const ownedList = {
  id: 'list-1',
  name: 'My List',
  ownerId: 'owner-1',
  owner: { id: 'owner-1', name: 'Jon', email: 'jon@example.com', image: null },
  listMembers: [
    {
      userId: 'member-1', role: 'member',
      user: { id: 'member-1', name: 'Mem', email: 'mem@example.com', image: null }
    },
  ],
}

describe('GET /api/v1/lists/:id/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ownerAuth as any)
    ;(mockPrisma.invitation.findMany as any).mockResolvedValue([])
  })

  it('returns 404 when list does not exist', async () => {
    ;(mockPrisma.taskList.findUnique as any).mockResolvedValue(null)
    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(404)
  })

  it('returns 403 for non-admin caller', async () => {
    ;(mockPrisma.taskList.findUnique as any).mockResolvedValue({
      ...ownedList,
      ownerId: 'someone-else',
      // also flip the relation so isListAdminOrOwner sees a foreign owner
      owner: { id: 'someone-else', name: 'X', email: 'x@example.com', image: null },
    })
    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(403)
  })

  it('returns owner + members + pending invites with correct types', async () => {
    ;(mockPrisma.taskList.findUnique as any).mockResolvedValue(ownedList)
    ;(mockPrisma.invitation.findMany as any).mockResolvedValue([
      { id: 'inv-1', email: 'invitee@example.com', role: 'member' },
    ])

    const res = await GET(makeReq('GET'), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.members).toHaveLength(3)
    expect(json.members[0]).toMatchObject({ id: 'owner-1', isOwner: true, role: 'owner' })
    expect(json.members[1]).toMatchObject({ id: 'member-1', role: 'member', type: 'member' })
    expect(json.members[2]).toMatchObject({
      id: 'invite_inv-1',
      email: 'invitee@example.com',
      type: 'invite',
    })
  })

  it('excludes invites whose email already joined', async () => {
    ;(mockPrisma.taskList.findUnique as any).mockResolvedValue(ownedList)
    ;(mockPrisma.invitation.findMany as any).mockResolvedValue([])

    await GET(makeReq('GET'), { params } as any)

    const inviteCall = (mockPrisma.invitation.findMany as any).mock.calls[0][0]
    expect(inviteCall.where.NOT.email.in).toEqual(
      expect.arrayContaining(['mem@example.com', 'jon@example.com'])
    )
  })
})

describe('POST /api/v1/lists/:id/members', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(ownerAuth as any)
  })

  it('returns 400 when email is missing', async () => {
    const res = await POST(makeReq('POST', {}), { params } as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid role', async () => {
    const res = await POST(makeReq('POST', { email: 'a@b.com', role: 'super' }), { params } as any)
    expect(res.status).toBe(400)
  })

  it('returns 404 when list does not exist', async () => {
    ;(mockPrisma.taskList.findUnique as any).mockResolvedValue(null)
    const res = await POST(makeReq('POST', { email: 'a@b.com' }), { params } as any)
    expect(res.status).toBe(404)
  })

  it('creates an invitation when invitee user does not exist', async () => {
    ;(mockPrisma.taskList.findUnique as any).mockResolvedValue(ownedList)
    ;(mockPrisma.user.findUnique as any).mockImplementation((args: any) => {
      if (args.where.email === 'newperson@example.com') return Promise.resolve(null)
      return Promise.resolve({ name: 'Jon', email: 'jon@example.com' })
    })
    ;(mockPrisma.invitation.findFirst as any).mockResolvedValue(null)
    ;(mockPrisma.invitation.create as any).mockResolvedValue({})

    const res = await POST(makeReq('POST', { email: 'NewPerson@example.com' }), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.invitation.email).toBe('newperson@example.com')

    const createCall = (mockPrisma.invitation.create as any).mock.calls[0][0]
    expect(createCall.data.email).toBe('newperson@example.com')
    expect(mockSendInvitation).toHaveBeenCalled()
  })

  it('returns 400 when invitation already exists', async () => {
    ;(mockPrisma.taskList.findUnique as any).mockResolvedValue(ownedList)
    ;(mockPrisma.user.findUnique as any).mockImplementation((args: any) => {
      if (args.where.email === 'a@b.com') return Promise.resolve(null)
      return Promise.resolve({ name: 'Jon', email: 'jon@example.com' })
    })
    ;(mockPrisma.invitation.findFirst as any).mockResolvedValue({ id: 'existing' })

    const res = await POST(makeReq('POST', { email: 'a@b.com' }), { params } as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when invitee is already the owner', async () => {
    ;(mockPrisma.taskList.findUnique as any).mockResolvedValue(ownedList)
    ;(mockPrisma.user.findUnique as any).mockResolvedValue({
      id: 'owner-1', name: 'Jon', email: 'jon@example.com', image: null,
    })

    const res = await POST(makeReq('POST', { email: 'jon@example.com' }), { params } as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when invitee is already a member', async () => {
    ;(mockPrisma.taskList.findUnique as any).mockResolvedValue(ownedList)
    ;(mockPrisma.user.findUnique as any).mockResolvedValue({
      id: 'member-1', name: 'Mem', email: 'mem@example.com', image: null,
    })

    const res = await POST(makeReq('POST', { email: 'mem@example.com' }), { params } as any)
    expect(res.status).toBe(400)
  })

  it('adds an existing user as a member', async () => {
    ;(mockPrisma.taskList.findUnique as any).mockResolvedValue(ownedList)
    ;(mockPrisma.user.findUnique as any).mockResolvedValue({
      id: 'newuser-1', name: 'New', email: 'new@example.com', image: null,
    })
    ;(mockPrisma.listMember.create as any).mockResolvedValue({})

    const res = await POST(makeReq('POST', { email: 'new@example.com', role: 'admin' }), { params } as any)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.member.id).toBe('newuser-1')
    expect(json.member.isAdmin).toBe(true)
  })
})
