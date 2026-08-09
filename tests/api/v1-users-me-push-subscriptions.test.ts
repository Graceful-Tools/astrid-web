/**
 * /api/v1/users/me/push-subscriptions (task 641a7615, decision 3A)
 *
 * Third of the five legacy `/api/user/*` endpoints with no v1 successor.
 *
 * Two things about the legacy semantics are worth pinning rather than
 * rediscovering, because both look like bugs if you do not know them:
 *
 * - DELETE **deactivates**, it does not delete. The row survives with
 *   `isActive: false`, which is what keeps a re-subscribe from losing history.
 * - the keys are nested (`{ endpoint, keys: { p256dh, auth } }`) because that
 *   is the shape the browser's PushSubscription serialises to — the client
 *   hands it straight over, so flattening it would mean every caller unpacking
 *   a W3C object by hand.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { pushSubscription: { upsert: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() } },
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

import { GET, POST, DELETE } from '@/app/api/v1/users/me/push-subscriptions/route'
import { prisma } from '@/lib/prisma'
import { authenticateAPI } from '@/lib/api-auth-middleware'

const mockPrisma = vi.mocked(prisma)
const mockAuth = vi.mocked(authenticateAPI)

const url = 'http://localhost/api/v1/users/me/push-subscriptions'
const req = (method: string, body?: unknown, query = '') =>
  new NextRequest(`${url}${query}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  })

const validBody = {
  endpoint: 'https://push.example.com/abc',
  keys: { p256dh: 'key', auth: 'secret' },
  userAgent: 'Firefox',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ userId: 'u1', source: 'session', scopes: ['*'], clientId: null } as never)
})

describe('POST /api/v1/users/me/push-subscriptions (task 641a7615)', () => {
  it('upserts on (user, endpoint) so re-subscribing is not a duplicate', async () => {
    mockPrisma.pushSubscription.upsert.mockResolvedValue({ id: 's1' } as never)

    const response = await POST(req('POST', validBody))

    expect(response.status).toBe(200)
    expect(mockPrisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_endpoint: { userId: 'u1', endpoint: validBody.endpoint } },
      }),
    )
  })

  it('reactivates a previously deactivated subscription', async () => {
    // DELETE only flips isActive; without this the browser could re-subscribe
    // to the same endpoint and still receive nothing.
    mockPrisma.pushSubscription.upsert.mockResolvedValue({ id: 's1' } as never)

    await POST(req('POST', validBody))

    const call = mockPrisma.pushSubscription.upsert.mock.calls[0][0] as never as { update: { isActive: boolean } }
    expect(call.update.isActive).toBe(true)
  })

  it('rejects an endpoint that is not a url', async () => {
    const response = await POST(req('POST', { ...validBody, endpoint: 'not-a-url' }))

    expect(response.status).toBe(400)
    expect(mockPrisma.pushSubscription.upsert).not.toHaveBeenCalled()
  })

  it('rejects a body missing the encryption keys', async () => {
    // Without p256dh/auth the subscription exists but no payload can ever be
    // encrypted for it — a silently dead subscription.
    const response = await POST(req('POST', { endpoint: validBody.endpoint }))

    expect(response.status).toBe(400)
    expect(mockPrisma.pushSubscription.upsert).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/users/me/push-subscriptions (task 641a7615)', () => {
  it('deactivates rather than deleting', async () => {
    mockPrisma.pushSubscription.updateMany.mockResolvedValue({ count: 1 } as never)

    const response = await DELETE(req('DELETE', undefined, '?endpoint=https%3A%2F%2Fpush.example.com%2Fabc'))

    expect(response.status).toBe(200)
    const call = mockPrisma.pushSubscription.updateMany.mock.calls[0][0] as never as { data: { isActive: boolean } }
    expect(call.data.isActive).toBe(false)
  })

  it('scopes the deactivation to the caller', async () => {
    // updateMany with an endpoint alone would let anyone kill another user's
    // subscription by guessing its endpoint.
    mockPrisma.pushSubscription.updateMany.mockResolvedValue({ count: 1 } as never)

    await DELETE(req('DELETE', undefined, '?endpoint=https%3A%2F%2Fpush.example.com%2Fabc'))

    const call = mockPrisma.pushSubscription.updateMany.mock.calls[0][0] as never as { where: { userId: string } }
    expect(call.where.userId).toBe('u1')
  })

  it('requires the endpoint', async () => {
    const response = await DELETE(req('DELETE'))

    expect(response.status).toBe(400)
    expect(mockPrisma.pushSubscription.updateMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/users/me/push-subscriptions (task 641a7615)', () => {
  it('lists only active subscriptions, without the secrets', async () => {
    mockPrisma.pushSubscription.findMany.mockResolvedValue([{ id: 's1', endpoint: 'e' }] as never)

    const body = await (await GET(req('GET'))).json()

    const call = mockPrisma.pushSubscription.findMany.mock.calls[0][0] as never as {
      where: { userId: string; isActive: boolean }
      select: Record<string, boolean>
    }
    expect(call.where).toMatchObject({ userId: 'u1', isActive: true })
    // p256dh/auth are the encryption secrets; they are write-only by design.
    expect(call.select.p256dh).toBeUndefined()
    expect(call.select.auth).toBeUndefined()
    expect(body.meta).toMatchObject({ apiVersion: 'v1' })
  })
})
