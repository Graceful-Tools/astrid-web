/**
 * Task e0613ae5 (found by sweeping for the "unauthenticated endpoint acting on
 * a client-supplied id" shape, the same shape as the user-search leak and the
 * unsubscribe link).
 *
 * `GET /api/coding-workflow/progress/[taskId]` had no authentication at all.
 * Anyone with a task id received:
 *
 *   - the task's title, and the first 200 characters of its description
 *   - previews of the last 10 AI-agent comments (which carry plans, file paths
 *     and code)
 *   - repositoryId, working branch, PR number and deployment URL
 *   - failure details from the workflow metadata
 *
 * That is private task content plus the identity of the repository it is being
 * worked in. Nothing in the app calls this endpoint — it is a monitoring hook —
 * so requiring auth breaks no caller.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    codingTaskWorkflow: { findUnique: vi.fn() },
    comment: { findMany: vi.fn() },
  },
}))

const requireTaskAccess = vi.hoisted(() => vi.fn())
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
    requireTaskAccess,
    getDeprecationWarning: vi.fn(() => null),
    UnauthorizedError,
    ForbiddenError,
  }
})

import { GET } from '@/app/api/coding-workflow/progress/[taskId]/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI, ForbiddenError } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const ctx = { params: Promise.resolve({ taskId: 'task-1' }) }

function req() {
  return new NextRequest('http://localhost/api/coding-workflow/progress/task-1')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAPI).mockResolvedValue({
    userId: 'u1', source: 'oauth', scopes: ['tasks:read'], isAIAgent: false,
    user: { id: 'u1', email: 'u@example.com', name: 'U', isAIAgent: false },
  } as never)
  requireTaskAccess.mockResolvedValue(undefined)
  mockPrisma.codingTaskWorkflow.findUnique.mockResolvedValue({
    id: 'wf-1', status: 'RUNNING', metadata: {},
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T01:00:00Z'),
    workingBranch: 'feat/secret-branch',
    pullRequestNumber: 42,
    repositoryId: 'AcmeCorp/private-repo',
    deploymentUrl: 'https://preview.example.com',
    task: {
      title: 'Private task title',
      description: 'Private description',
      createdAt: new Date('2026-08-01T00:00:00Z'),
    },
  } as never)
  mockPrisma.comment.findMany.mockResolvedValue([] as never)
})

describe('coding-workflow progress requires task access (task e0613ae5)', () => {
  it('checks task access before returning anything', async () => {
    await GET(req() as never, ctx as never)

    expect(requireTaskAccess).toHaveBeenCalledWith('u1', 'task-1')
  })

  it('refuses a caller without access, leaking neither task nor repository', async () => {
    requireTaskAccess.mockRejectedValue(new ForbiddenError())

    const res = await GET(req() as never, ctx as never)
    const body = await res.text()

    expect(res.status).toBe(403)
    // The specifics that used to come back to anyone at all.
    expect(body).not.toContain('Private task title')
    expect(body).not.toContain('AcmeCorp/private-repo')
    expect(body).not.toContain('feat/secret-branch')
  })

  it('still serves a caller who does have access', async () => {
    const res = await GET(req() as never, ctx as never)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.task.title).toBe('Private task title')
    expect(body.deployment.repositoryId).toBe('AcmeCorp/private-repo')
  })
})
