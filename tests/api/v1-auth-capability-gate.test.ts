/**
 * RED for task 3ba0719f — the v1 sign-in endpoints ignore the brand capability
 * switch that their legacy twins enforce.
 *
 * app/api/auth/google and app/api/auth/apple each open with
 * `capabilityGate('authGoogle' | 'authApple')`, which 404s when the method is
 * disabled for the deployment. Neither v1 route had one, so turning Google
 * sign-in off still left /api/v1/auth/google minting 30-day sessions — the
 * switch only closed the front door, and v1 is the path iOS uses.
 *
 * The gate must also run BEFORE the body is read, so a disabled method cannot
 * be probed for its validation behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const capabilityGate = vi.hoisted(() => vi.fn())
vi.mock('@/lib/brand/capabilities', () => ({
  capabilityGate,
  CAPABILITIES: {},
}))

// The rate limiter wraps the handler; pass straight through so these cases are
// about the gate and nothing else.
vi.mock('@/lib/rate-limiter', () => ({
  withRateLimitHandler: (handler: unknown) => handler,
  authRateLimiter: {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    account: { create: vi.fn() },
    session: { create: vi.fn() },
  },
}))

vi.mock('@/lib/default-lists', () => ({ createDefaultListsForUser: vi.fn() }))
vi.mock('@/lib/auth/google-identity', () => ({ resolveGoogleIdentity: vi.fn() }))
vi.mock('@/lib/auth/apple-identity', () => ({
  resolveAppleIdentity: vi.fn(),
  appleAllowedAudiences: vi.fn(() => []),
}))

import { POST as googlePOST } from '@/app/api/v1/auth/google/route'
import { POST as applePOST } from '@/app/api/v1/auth/apple/route'
import { prisma } from '@/lib/prisma'

const mockPrisma = vi.mocked(prisma)

const disabled = () =>
  new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  })

function req(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  global.fetch = vi.fn() as never
})

describe('v1 sign-in honours the brand capability switch (task 3ba0719f)', () => {
  it('404s POST /api/v1/auth/google when authGoogle is off, without touching the database', async () => {
    capabilityGate.mockReturnValue(disabled())

    const res = await googlePOST(req('/api/v1/auth/google', { idToken: 'tok' }))

    expect(res.status).toBe(404)
    expect(capabilityGate).toHaveBeenCalledWith('authGoogle')
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.session.create).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('404s POST /api/v1/auth/apple when authApple is off, without touching the database', async () => {
    capabilityGate.mockReturnValue(disabled())

    const res = await applePOST(req('/api/v1/auth/apple', { identityToken: 'tok' }))

    expect(res.status).toBe(404)
    expect(capabilityGate).toHaveBeenCalledWith('authApple')
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled()
    expect(mockPrisma.session.create).not.toHaveBeenCalled()
  })

  it('gates before reading the body, so a disabled method cannot be probed', async () => {
    capabilityGate.mockReturnValue(disabled())

    // No token at all. A 400 here would confirm the route exists and reveal
    // what it wants; the answer must be the same 404 either way.
    expect((await googlePOST(req('/api/v1/auth/google', {}))).status).toBe(404)
    expect((await applePOST(req('/api/v1/auth/apple', {}))).status).toBe(404)
  })

  it('does not interfere when the method is enabled', async () => {
    capabilityGate.mockReturnValue(null)

    // Enabled: the gate returns nothing and the handler proceeds to its own
    // validation, which rejects the empty body on its own terms.
    const res = await googlePOST(req('/api/v1/auth/google', {}))

    expect(res.status).toBe(400)
  })
})
