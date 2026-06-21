/**
 * Contract tests for GET /api/v1/tasks — the core task list surface iOS reads.
 *
 * Unlike the key-set tests that assert a literal matches a hardcoded array,
 * these invoke the REAL route handler (through the real withAuth wrapper) and
 * pin the response envelope, default ordering, pagination, and the
 * error-shape / status-code contract. A change to any of these would silently
 * break the iOS list, so it should break this test first.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findMany: vi.fn(),
      count: vi.fn(),
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
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

import { GET } from '@/app/api/v1/tasks/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI, requireScopes, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)
const mockRequireScopes = vi.mocked(requireScopes)

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['tasks:read'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/v1/tasks${query}`, { method: 'GET' })
}

const sampleTasks = [
  { id: 't1', title: 'A', completed: false, priority: 2, lists: [{ id: 'l1' }, { id: 'l2' }] },
  { id: 't2', title: 'B', completed: true, priority: 0, lists: [] },
]

describe('GET /api/v1/tasks — iOS list contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(auth as never)
    mockRequireScopes.mockReturnValue(undefined as never)
    ;(mockPrisma.task.findMany as never as ReturnType<typeof vi.fn>).mockResolvedValue(sampleTasks as never)
    ;(mockPrisma.task.count as never as ReturnType<typeof vi.fn>).mockResolvedValue(2 as never)
  })

  it('returns the pinned envelope: { tasks, meta:{ total, limit, offset, apiVersion, authSource } }', async () => {
    const res = await GET(makeReq(), {} as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(['meta', 'tasks'])
    expect(body.meta).toEqual({
      total: 2,
      limit: 100,
      offset: 0,
      apiVersion: 'v1',
      authSource: 'oauth',
    })
  })

  it('attaches a flat listIds array to every task (iOS flattens the relation)', async () => {
    const res = await GET(makeReq(), {} as never)
    const body = await res.json()
    expect(body.tasks).toHaveLength(2)
    expect(body.tasks[0].listIds).toEqual(['l1', 'l2'])
    expect(body.tasks[1].listIds).toEqual([])
  })

  it('uses the stable default ordering (completed asc, priority desc, createdAt desc)', async () => {
    await GET(makeReq(), {} as never)
    const args = (mockPrisma.task.findMany as never as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args.orderBy).toEqual([
      { completed: 'asc' },
      { priority: 'desc' },
      { createdAt: 'desc' },
    ])
  })

  it('defaults pagination to take 100 / skip 0', async () => {
    await GET(makeReq(), {} as never)
    const args = (mockPrisma.task.findMany as never as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args.take).toBe(100)
    expect(args.skip).toBe(0)
  })

  it('honors limit/offset query params', async () => {
    await GET(makeReq('?limit=25&offset=50'), {} as never)
    const args = (mockPrisma.task.findMany as never as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args.take).toBe(25)
    expect(args.skip).toBe(50)
  })

  it('error contract: 401 { error } when unauthenticated', async () => {
    mockAuth.mockRejectedValue(new UnauthorizedError('no token'))
    const res = await GET(makeReq(), {} as never)
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('error contract: 403 { error } when scope is missing', async () => {
    mockRequireScopes.mockImplementation(() => { throw new ForbiddenError('missing scope') })
    const res = await GET(makeReq(), {} as never)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toBe('Forbidden')
  })
})
