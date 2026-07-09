import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    externalTaskLink: {
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/api-auth-middleware', () => {
  class UnauthorizedError extends Error {}
  class ForbiddenError extends Error {}
  return {
    authenticateAPI: vi.fn(),
    requireScopes: vi.fn(),
    requireTaskAccess: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
  }
})

import { DELETE } from '@/app/api/v1/sync/github/task-links/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI, requireScopes } from '@/lib/api-auth-middleware'

const auth = {
  userId: 'user-1',
  source: 'oauth' as const,
  scopes: ['tasks:write'],
  isAIAgent: false,
  user: { id: 'user-1', email: 'jon@example.com', name: 'Jon', isAIAgent: false },
}

function request(query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/v1/sync/github/task-links${query}`, { method: 'DELETE' })
}

describe('DELETE /api/v1/sync/github/task-links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAPI).mockResolvedValue(auth as never)
    vi.mocked(requireScopes).mockReturnValue(undefined as never)
  })

  it('requires both task and remote identity', async () => {
    const response = await DELETE(request('?astridTaskId=task-1'), {} as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'astridTaskId and remoteId required' })
    expect(prisma.externalTaskLink.deleteMany).not.toHaveBeenCalled()
  })

  it('deletes only the caller-owned matching GitHub link', async () => {
    vi.mocked(prisma.externalTaskLink.deleteMany).mockResolvedValue({ count: 1 })

    const response = await DELETE(request('?astridTaskId=task-1&remoteId=owner%2Frepo%2323'), {} as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, detached: true })
    expect(prisma.externalTaskLink.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        provider: 'GITHUB_ISSUES',
        astridTaskId: 'task-1',
        remoteId: 'owner/repo#23',
      },
    })
  })

  it('is idempotent when the link is already absent', async () => {
    vi.mocked(prisma.externalTaskLink.deleteMany).mockResolvedValue({ count: 0 })

    const response = await DELETE(request('?astridTaskId=task-1&remoteId=owner%2Frepo%2323'), {} as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ success: true, detached: false })
  })
})
