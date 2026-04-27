import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findUnique: vi.fn(),
    },
    taskList: {
      findFirst: vi.fn(),
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

vi.mock('@/lib/shortcode', () => ({
  createShortcode: vi.fn(),
  getShortcodesForTarget: vi.fn(),
  buildShortcodeUrl: vi.fn((code: string) => `https://astrid.cc/s/${code}`),
}))

import { POST, GET } from '@/app/api/v1/shortcodes/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { createShortcode, getShortcodesForTarget } from '@/lib/shortcode'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)
const mockCreateShortcode = vi.mocked(createShortcode)
const mockGetShortcodesForTarget = vi.mocked(getShortcodesForTarget)

const authedUser = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['tasks:read'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(method: 'POST' | 'GET', url: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe('POST /api/v1/shortcodes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 400 when targetType is missing', async () => {
    const res = await POST(
      makeReq('POST', 'http://localhost/api/v1/shortcodes', { targetId: 'x' }),
      undefined as any
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid targetType', async () => {
    const res = await POST(
      makeReq('POST', 'http://localhost/api/v1/shortcodes', { targetType: 'thing', targetId: 'x' }),
      undefined as any
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when task does not exist', async () => {
    ;(mockPrisma.task.findUnique as any).mockResolvedValue(null)
    const res = await POST(
      makeReq('POST', 'http://localhost/api/v1/shortcodes', { targetType: 'task', targetId: 't-1' }),
      undefined as any
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 when caller lacks task access', async () => {
    ;(mockPrisma.task.findUnique as any).mockResolvedValue({
      id: 't-1', creatorId: 'someone-else', lists: [{ id: 'list-1' }],
    })
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(null)

    const res = await POST(
      makeReq('POST', 'http://localhost/api/v1/shortcodes', { targetType: 'task', targetId: 't-1' }),
      undefined as any
    )
    expect(res.status).toBe(403)
  })

  it('creates a shortcode when caller is the task creator', async () => {
    ;(mockPrisma.task.findUnique as any).mockResolvedValue({
      id: 't-1', creatorId: 'user-1', lists: [],
    })
    ;(mockCreateShortcode as any).mockResolvedValue({ code: 'abc123' })

    const res = await POST(
      makeReq('POST', 'http://localhost/api/v1/shortcodes', { targetType: 'task', targetId: 't-1' }),
      undefined as any
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.shortcode.code).toBe('abc123')
    expect(json.url).toBe('https://astrid.cc/s/abc123')
  })

  it('returns 404 when list is not accessible', async () => {
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue(null)
    const res = await POST(
      makeReq('POST', 'http://localhost/api/v1/shortcodes', { targetType: 'list', targetId: 'list-1' }),
      undefined as any
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/v1/shortcodes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue(authedUser as any)
  })

  it('returns 400 when params are missing', async () => {
    const res = await GET(
      makeReq('GET', 'http://localhost/api/v1/shortcodes'),
      undefined as any
    )
    expect(res.status).toBe(400)
  })

  it('returns shortcodes for a list when caller has access', async () => {
    ;(mockPrisma.taskList.findFirst as any).mockResolvedValue({ id: 'list-1' })
    ;(mockGetShortcodesForTarget as any).mockResolvedValue([
      { code: 'abc' },
      { code: 'xyz' },
    ])

    const res = await GET(
      makeReq('GET', 'http://localhost/api/v1/shortcodes?targetType=list&targetId=list-1'),
      undefined as any
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.shortcodes).toHaveLength(2)
    expect(json.shortcodes[0].url).toBe('https://astrid.cc/s/abc')
    expect(json.meta.count).toBe(2)
  })
})
