/**
 * v1 smart-tasks must carry `subtaskDisplay` (task 641a7615, decision 3A).
 *
 * The successor to legacy `/api/user/settings` is `/api/v1/users/me/smart-tasks`,
 * NOT `/api/v1/users/me/settings` — the names collide but the resources do not.
 * v1 `settings` returns identity plus reminder settings; the task-creation
 * preferences live under smart-tasks. Migrating a call site by name match would
 * swap it onto a completely different resource.
 *
 * And smart-tasks covered only four of the five fields the legacy route serves.
 * `subtaskDisplay` was missing, which is the quiet kind of gap: the Appearance
 * settings panel both reads and writes it, so a path swap would have made the
 * read fall through to the 'indented' default and the write silently vanish —
 * a preference that appears to save and is gone on reload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    taskList: { findFirst: vi.fn() },
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
    UnauthorizedError, ForbiddenError, getDeprecationWarning: vi.fn(() => null),
  }
})

import { GET, PATCH } from '@/app/api/v1/users/me/smart-tasks/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const req = (method: 'GET' | 'PATCH', body?: unknown) =>
  new NextRequest('http://localhost/api/v1/users/me/smart-tasks', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.user.update.mockResolvedValue({ subtaskDisplay: 'under_parent' } as never)
})

describe('GET /api/v1/users/me/smart-tasks (task 641a7615)', () => {
  it('returns subtaskDisplay', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ subtaskDisplay: 'under_parent' } as never)

    const body = await (await GET(req('GET'))).json()

    expect(body.subtaskDisplay).toBe('under_parent')
  })

  it('selects subtaskDisplay from the database', async () => {
    // Without it in the select, the field is simply absent from the response
    // and the client falls back to its default with no error anywhere.
    mockPrisma.user.findUnique.mockResolvedValue({} as never)

    await GET(req('GET'))

    const call = mockPrisma.user.findUnique.mock.calls[0][0] as never as { select: Record<string, boolean> }
    expect(call.select.subtaskDisplay).toBe(true)
  })
})

describe('PATCH /api/v1/users/me/smart-tasks (task 641a7615)', () => {
  it('persists subtaskDisplay', async () => {
    // The field was not in ALLOWED, so it was dropped from the update silently:
    // the panel reported success and the preference was gone on reload.
    const response = await PATCH(req('PATCH', { subtaskDisplay: 'under_parent' }))

    expect(response.status).toBe(200)
    const call = mockPrisma.user.update.mock.calls[0][0] as never as { data: Record<string, unknown> }
    expect(call.data.subtaskDisplay).toBe('under_parent')
  })

  it('rejects a subtaskDisplay value the UI cannot render', async () => {
    const response = await PATCH(req('PATCH', { subtaskDisplay: 'sideways' }))

    expect(response.status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })

  it('still ignores fields outside the allow-list', async () => {
    // Adding one field must not turn the allow-list into a pass-through.
    await PATCH(req('PATCH', { subtaskDisplay: 'indented', isAdmin: true }))

    const call = mockPrisma.user.update.mock.calls[0][0] as never as { data: Record<string, unknown> }
    expect(call.data.isAdmin).toBeUndefined()
  })
})
