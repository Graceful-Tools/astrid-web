/**
 * RED for task e0613ae5 — v1 list copy reports a refused copy as a server error.
 *
 * copyListWithTasks does its own access check and returns
 * `{ success: false, error: "Access denied to copy this list" }` for a list the
 * caller may not copy. Legacy turns that into a 400. v1 turns it into a 500.
 *
 * A 500 tells the caller "we broke", which is wrong twice over: the client
 * retries something that will never succeed, and a real outage is now
 * indistinguishable from a permission denial in the logs.
 *
 * v1 does have its own pre-check that 403s a non-public list the caller has no
 * role on — but it only runs for non-public lists, and it uses a different
 * helper (hasExplicitListRole) than copy-utils does (canAccessList). Anything
 * the pre-check lets through and copy-utils then refuses lands on the 500.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    taskList: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}))

const copyListWithTasks = vi.hoisted(() => vi.fn())
vi.mock('@/lib/copy-utils', () => ({ copyListWithTasks }))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

import { POST } from '@/app/api/v1/lists/[id]/copy/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const USER = 'user-1'
const params = Promise.resolve({ id: 'list-1' })

function req(body: unknown = {}) {
  return new NextRequest('http://localhost/api/v1/lists/list-1/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({
    userId: USER,
    source: 'oauth' as const,
    scopes: ['lists:read', 'lists:write'],
    isAIAgent: false,
    user: { id: USER, email: 'jon@example.com', name: 'Jon', isAIAgent: false },
  } as never)
  // A PUBLIC list, so v1's own pre-check passes and the decision falls to
  // copy-utils — which is the path that produced the 500.
  mockPrisma.taskList.findUnique.mockResolvedValue({
    id: 'list-1', name: 'Featured', privacy: 'PUBLIC', ownerId: 'someone-else',
    owner: { id: 'someone-else', name: 'Other', email: 'o@x.com' },
    listMembers: [],
  } as never)
  mockPrisma.user.findUnique.mockResolvedValue({ name: 'Jon', email: 'jon@example.com' } as never)
})

describe('v1 list copy failure status (task e0613ae5)', () => {
  it('does not report a refused copy as a server error', async () => {
    copyListWithTasks.mockResolvedValue({
      success: false,
      error: 'Access denied to copy this list',
    })

    const res = await POST(req(), { params } as never)

    expect(res.status).not.toBe(500)
  })

  it('matches legacy and answers 400, carrying the reason through', async () => {
    copyListWithTasks.mockResolvedValue({
      success: false,
      error: 'Access denied to copy this list',
    })

    const res = await POST(req(), { params } as never)

    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Access denied to copy this list')
  })

  it('still 500s nothing on the happy path', async () => {
    copyListWithTasks.mockResolvedValue({
      success: true,
      copiedList: { id: 'copy-1' },
      copiedTasksCount: 3,
    })

    const res = await POST(req(), { params } as never)

    expect(res.status).toBeLessThan(400)
  })
})
