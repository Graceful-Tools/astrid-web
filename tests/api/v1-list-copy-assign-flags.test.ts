/**
 * RED for task ba44d068 — POST /api/v1/lists/:id/copy silently drops
 * `assignToUser` and `preserveTaskAssignees` from the request body.
 *
 * This is not a hypothetical parity gap. hooks/useTaskManagerController.ts
 * (handleCopyList) posts to the *v1* endpoint and computes
 *
 *     assignToUser = !isViewingFromFeatured || !isUserOwnerOrAdmin
 *
 * so when you copy your own list from the Featured browser it asks for
 * `assignToUser: false` — don't reassign every task to me. The v1 route
 * hardcodes `assignToUser: true, preserveTaskAssignees: false` and never reads
 * the body, so copy-utils takes the `options.assignToUser !== false` branch and
 * stamps you as the assignee on every task and as the new list's
 * defaultAssigneeId.
 *
 * The legacy route has always passed both flags through.
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

import { POST } from '@/app/api/v1/lists/[id]/copy/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const auth = {
  userId: 'owner-1',
  source: 'oauth' as const,
  scopes: ['lists:read', 'lists:write'],
  isAIAgent: false,
  user: { id: 'owner-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/lists/list-1/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const params = Promise.resolve({ id: 'list-1' })

const copyOptions = () => copyListWithTasks.mock.calls[0][1]

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue(auth as never)
  mockPrisma.taskList.findUnique.mockResolvedValue({
    id: 'list-1',
    name: 'Featured List',
    privacy: 'PUBLIC',
    ownerId: 'owner-1',
    owner: { id: 'owner-1', name: 'Jon', email: 'jon@example.com' },
    listMembers: [],
  } as never)
  mockPrisma.user.findUnique.mockResolvedValue({ name: 'Jon', email: 'jon@example.com' } as never)
  copyListWithTasks.mockResolvedValue({ success: true, copiedList: { id: 'copy-1' }, copiedTasksCount: 3 })
})

describe('POST /api/v1/lists/:id/copy — assignment flags (task ba44d068)', () => {
  it('honours assignToUser: false instead of assigning every task to the copier', async () => {
    // This is the exact body the web client sends when you copy your own list
    // from the Featured browser.
    await POST(makeReq({ includeTasks: true, preserveTaskAssignees: false, assignToUser: false }), { params } as never)

    expect(copyOptions().assignToUser).toBe(false)
  })

  it('honours preserveTaskAssignees: true', async () => {
    await POST(makeReq({ includeTasks: true, preserveTaskAssignees: true }), { params } as never)

    expect(copyOptions().preserveTaskAssignees).toBe(true)
  })

  it('still defaults to assigning the copier when the body says nothing', async () => {
    // The default must not change — most copies are "make this mine".
    await POST(makeReq({}), { params } as never)

    expect(copyOptions().assignToUser).toBe(true)
    expect(copyOptions().preserveTaskAssignees).toBe(false)
  })
})
