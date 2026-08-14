/**
 * Task 92e582c6 — GET /api/v1/tasks/[id] must use the READ access check, and
 * DELETE must keep using the write one.
 *
 * The behaviour of the two checks is covered in tests/lib/task-read-access.test.ts.
 * What this file pins is the wiring: the whole safety argument for adding a
 * PUBLIC-list branch at all is that it reaches reads and nothing else, and that
 * argument is one careless import away from being false. A swap here would not
 * fail any other test — it would just quietly let a stranger delete tasks on
 * public lists.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
    requireTaskAccess: vi.fn(),
    requireTaskReadAccess: vi.fn(),
    UnauthorizedError,
    ForbiddenError,
    getDeprecationWarning: vi.fn(() => null),
  }
})

vi.mock('@/lib/task-identifier', () => ({
  resolveTaskIdOrIdentifier: vi.fn(async (id: string) => id),
}))

import { GET, DELETE } from '@/app/api/v1/tasks/[id]/route'
import { prisma } from '@/lib/prisma'
import {
  authenticateAPI,
  requireTaskAccess,
  requireTaskReadAccess,
} from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)
const mockWriteCheck = vi.mocked(requireTaskAccess)
const mockReadCheck = vi.mocked(requireTaskReadAccess)

const ctx = { params: Promise.resolve({ id: 'task-1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.task.findUnique.mockResolvedValue({ id: 'task-1', lists: [] } as never)
})

describe('v1 /tasks/[id] access-check wiring (task 92e582c6)', () => {
  it('GET uses the read check, which admits public lists', async () => {
    await GET(new NextRequest('http://localhost/api/v1/tasks/task-1'), ctx as never)

    expect(mockReadCheck).toHaveBeenCalledWith('u1', 'task-1')
    expect(mockWriteCheck).not.toHaveBeenCalled()
  })

  it('DELETE keeps the write check, which does not', async () => {
    await DELETE(
      new NextRequest('http://localhost/api/v1/tasks/task-1', { method: 'DELETE' }),
      ctx as never,
    )

    expect(mockWriteCheck).toHaveBeenCalledWith('u1', 'task-1')
    expect(mockReadCheck).not.toHaveBeenCalled()
  })
})
