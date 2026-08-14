/**
 * Task e0613ae5 — neither user-search route may search a list the caller does
 * not belong to.
 *
 * The rule itself is covered in tests/lib/user-search-scope.test.ts. This pins
 * the wiring on BOTH routes, because the vulnerability was identical in both
 * and a fix applied to only one would look complete from either side.
 *
 * The assertion is deliberately about the DATABASE QUERY rather than the
 * response body: the leak was that a stranger's list ids reached
 * `prisma.user.findMany`. If they never reach it, there is nothing to leak.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    taskList: { findMany: vi.fn() },
    task: { findFirst: vi.fn(), findUnique: vi.fn() },
    session: { findUnique: vi.fn() },
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
    authenticateAPI: vi.fn(), requireScopes: vi.fn(),
    getDeprecationWarning: vi.fn(() => null), UnauthorizedError, ForbiddenError,
  }
})

vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn() }))
vi.mock('@/lib/ai/assignable-agents', () => ({
  getAssignableAgentEmails: () => [],
  getKeyedAgentEmails: () => [],
}))
vi.mock('@/lib/brand/agent-emails', () => ({ openClawEmailSuffix: () => '.oc@example.com' }))
vi.mock('@/lib/ai-agent-utils', () => ({ isCodingAgent: () => false }))
vi.mock('@/lib/api-key-cache', () => ({ hasValidApiKey: vi.fn(async () => false) }))

import { GET as v1Search } from '@/app/api/v1/users/search/route'
import { GET as legacySearch } from '@/app/api/users/search/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { getUnifiedSession } from '@/lib/session-utils'

const mockPrisma = vi.mocked(prisma, true)
const STRANGER = 'stranger-1'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAPI).mockResolvedValue({
    userId: STRANGER, source: 'oauth', scopes: ['user:read'], isAIAgent: false,
    user: { id: STRANGER, email: 's@example.com', name: 'S', isAIAgent: false },
  } as never)
  vi.mocked(getUnifiedSession).mockResolvedValue({
    user: { id: STRANGER, email: 's@example.com', name: 'S' },
  } as never)
  // The caller belongs to NO list — so the visibility filter returns nothing.
  mockPrisma.taskList.findMany.mockResolvedValue([] as never)
  mockPrisma.user.findMany.mockResolvedValue([] as never)
  mockPrisma.task.findFirst.mockResolvedValue(null as never)
  mockPrisma.user.findUnique.mockResolvedValue(null as never)
})

function url(path: string) {
  return new NextRequest(`http://localhost${path}`)
}

describe("user search cannot reach a stranger's list (task e0613ae5)", () => {
  it('v1: a list id the caller does not belong to never reaches the user query', async () => {
    const res = await v1Search(url('/api/v1/users/search?listIds=someone-elses-list'))

    expect(res.status).toBe(200)
    // The whole leak: these ids used to be passed straight through.
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
    expect((await res.json()).users).toEqual([])
  })

  it('legacy: same', async () => {
    const res = await legacySearch(url('/api/users/search?listIds=someone-elses-list'))

    expect(res.status).toBe(200)
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
  })

  it('v1: a taskId the caller cannot see yields nothing', async () => {
    // task.findFirst is scoped to the caller and returns null for a task they
    // cannot see, so no lists are derived from it.
    const res = await v1Search(url('/api/v1/users/search?taskId=not-mine'))

    expect(res.status).toBe(200)
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled()
  })

  it('v1: a list the caller DOES belong to is still searchable', async () => {
    // The fix must not break the feature it protects.
    mockPrisma.taskList.findMany.mockResolvedValue([{ id: 'mine' }] as never)
    mockPrisma.user.findMany.mockResolvedValue([
      { id: 'u2', name: 'Colleague', email: 'c@example.com', image: null },
    ] as never)

    const res = await v1Search(url('/api/v1/users/search?listIds=mine'))
    const body = await res.json()

    expect(mockPrisma.user.findMany).toHaveBeenCalled()
    expect(body.users.map((u: { id: string }) => u.id)).toContain('u2')
  })
})
