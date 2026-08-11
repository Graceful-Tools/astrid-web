/**
 * GET/PUT /api/v1/users/me/default-due-time (task 641a7615, decision 3A)
 *
 * One of the five legacy `/api/user/*` endpoints with no v1 successor. The
 * other seven already had one under `/api/v1/users/me/*`, several renamed —
 * which is why a path-prefix audit missed them.
 *
 * Two things this port changes on purpose, both worth pinning:
 *
 * - it identifies the user by `auth.userId`, not by email. The legacy route
 *   looks users up by `session.user.email`, which cannot work for an OAuth
 *   token (no email in scope) and breaks outright if an email ever changes.
 * - it accepts OAuth as well as a session cookie, which is the actual point of
 *   having a v1 twin rather than just renaming the path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: vi.fn(), update: vi.fn() } },
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

import { GET, PUT } from '@/app/api/v1/users/me/default-due-time/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const req = (method: 'GET' | 'PUT', body?: unknown) =>
  new NextRequest('http://localhost/api/v1/users/me/default-due-time', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

describe('GET /api/v1/users/me/default-due-time (task 641a7615)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ userId: 'u1', source: 'oauth', scopes: ['*'], clientId: 'c1' } as never)
  })

  it('returns the stored time with a v1 meta envelope', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ defaultDueTime: '09:00' } as never)

    const body = await (await GET(req('GET'))).json()

    expect(body.defaultDueTime).toBe('09:00')
    expect(body.meta).toMatchObject({ apiVersion: 'v1' })
  })

  it('looks the user up by id, never by email', async () => {
    // The legacy route keys on session.user.email, which an OAuth token does
    // not carry — porting that lookup would make the v1 route unusable by the
    // very callers v1 exists for.
    mockPrisma.user.findUnique.mockResolvedValue({ defaultDueTime: null } as never)

    await GET(req('GET'))

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' } }),
    )
  })

  it('reports a user that no longer exists as 404, not as a null setting', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null as never)

    expect((await GET(req('GET'))).status).toBe(404)
  })
})

describe('PUT /api/v1/users/me/default-due-time (task 641a7615)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
    mockPrisma.user.update.mockResolvedValue({ defaultDueTime: '17:30' } as never)
  })

  it('saves a time', async () => {
    const response = await PUT(req('PUT', { defaultDueTime: '17:30' }))

    expect(response.status).toBe(200)
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' }, data: { defaultDueTime: '17:30' } }),
    )
  })

  it('accepts null to clear the default', async () => {
    // Legacy allows null explicitly; dropping that would leave users unable to
    // go back to "no default" once they set one.
    mockPrisma.user.update.mockResolvedValue({ defaultDueTime: null } as never)

    const response = await PUT(req('PUT', { defaultDueTime: null }))

    expect(response.status).toBe(200)
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { defaultDueTime: null } }),
    )
  })

  it('rejects a non-string, non-null value', async () => {
    const response = await PUT(req('PUT', { defaultDueTime: 42 }))

    expect(response.status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('rejects a body with no defaultDueTime at all', async () => {
    // An empty PATCH-like body must not be read as "clear it".
    const response = await PUT(req('PUT', {}))

    expect(response.status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })
})
