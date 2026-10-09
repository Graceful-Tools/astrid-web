/**
 * v1 smart-tasks carries `showListImages` — the "Show list images" opt-in/out
 * for the hide_list_images A/B test (lib/list-images-visibility.ts).
 *
 * Tri-state on purpose: null = follow the experiment, true/false = the user
 * chose. iOS reads and writes it through this route, so null must round-trip
 * (it is how a user returns to "follow the experiment") and a non-boolean must
 * be rejected rather than stored.
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

const mockPrisma = vi.mocked(prisma, true)
const mockAuth = vi.mocked(authenticateAPI)

const req = (method: 'GET' | 'PATCH', body?: unknown) =>
  new NextRequest('http://localhost/api/v1/users/me/smart-tasks', {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
  mockPrisma.user.update.mockResolvedValue({ showListImages: true } as never)
})

describe('GET /api/v1/users/me/smart-tasks — showListImages', () => {
  it('selects and returns showListImages, null included', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ showListImages: null } as never)

    const body = await (await GET(req('GET'))).json()

    const call = mockPrisma.user.findUnique.mock.calls[0][0] as never as { select: Record<string, boolean> }
    expect(call.select.showListImages).toBe(true)
    expect(body).toHaveProperty('showListImages', null)
  })
})

describe('PATCH /api/v1/users/me/smart-tasks — showListImages', () => {
  it.each([[true], [false], [null]])('persists %s', async value => {
    const response = await PATCH(req('PATCH', { showListImages: value }))

    expect(response.status).toBe(200)
    const call = mockPrisma.user.update.mock.calls[0][0] as never as { data: Record<string, unknown> }
    expect(call.data).toHaveProperty('showListImages', value)
  })

  it.each([['yes'], [1], [{}]])('rejects %j', async value => {
    const response = await PATCH(req('PATCH', { showListImages: value }))

    expect(response.status).toBe(400)
    expect(mockPrisma.user.update).not.toHaveBeenCalled()
  })
})
