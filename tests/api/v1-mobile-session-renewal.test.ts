/**
 * Task 1e0eddcb — `GET /api/v1/auth/mobile-session` slides the session window.
 *
 * The behaviour of the decision itself is covered in
 * tests/lib/mobile-session-renewal.test.ts. What this pins is the route: that
 * a renewal actually reaches the client, that an expired session is still
 * refused, and — the part most likely to bite — that a renewal FAILURE does not
 * turn a valid session into a sign-out. The whole bug being fixed is users
 * being bounced to a login screen, so a fix that can 401 on its own error would
 * be worse than the bug.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/prisma', () => ({
  prisma: { session: { findUnique: vi.fn(), delete: vi.fn(), update: vi.fn() } },
}))

const decode = vi.hoisted(() => vi.fn())
vi.mock('next-auth/jwt', () => ({ decode, encode: vi.fn() }))

const renewSessionToken = vi.hoisted(() => vi.fn())
vi.mock('@/lib/mobile-session-renewal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mobile-session-renewal')>()
  return { ...actual, renewSessionToken }
})

import { GET } from '@/app/api/v1/auth/mobile-session/route'
import { prisma } from '@/lib/prisma'
import { SESSION_MAX_AGE_SECONDS } from '@/lib/mobile-session-renewal'

const mockPrisma = vi.mocked(prisma)

function req() {
  const r = new NextRequest('http://localhost/api/v1/auth/mobile-session')
  r.cookies.set('next-auth.session-token', 'cookie-value')
  return r
}

const NOW = () => Math.floor(Date.now() / 1000)

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = 'test-secret'
  renewSessionToken.mockResolvedValue({
    token: 'fresh-token',
    expiresAt: new Date((NOW() + SESSION_MAX_AGE_SECONDS) * 1000),
  })
})

describe('GET /api/v1/auth/mobile-session — JWT path (task 1e0eddcb)', () => {
  it('hands back a renewed token once the session is stale', async () => {
    // 25 hours old — past the update age.
    decode.mockResolvedValue({
      id: 'u1', email: 'u@example.com', name: 'U', image: null,
      exp: NOW() + SESSION_MAX_AGE_SECONDS - 25 * 60 * 60,
    })

    const body = await (await GET(req())).json()

    expect(body.user.id).toBe('u1')
    expect(body.sessionToken).toBe('fresh-token')
    expect(body.expiresAt).toBeTruthy()
  })

  it('omits the token entirely for a fresh session', async () => {
    decode.mockResolvedValue({
      id: 'u1', email: 'u@example.com', name: 'U', image: null,
      exp: NOW() + SESSION_MAX_AGE_SECONDS,
    })

    const body = await (await GET(req())).json()

    // No field at all rather than null: a client checking `if (sessionToken)`
    // must not be handed something falsy-but-present to store.
    expect('sessionToken' in body).toBe(false)
    expect(renewSessionToken).not.toHaveBeenCalled()
  })

  it('still 401s an expired session rather than renewing it', async () => {
    decode.mockResolvedValue({ id: 'u1', exp: NOW() - 60 })

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(renewSessionToken).not.toHaveBeenCalled()
  })

  it('serves the session anyway when renewal throws', async () => {
    // The failure mode that matters: renewal is a bonus, not a precondition.
    // A user with a valid session must never be signed out because minting a
    // replacement failed.
    decode.mockResolvedValue({
      id: 'u1', email: 'u@example.com', name: 'U', image: null,
      exp: NOW() + SESSION_MAX_AGE_SECONDS - 25 * 60 * 60,
    })
    renewSessionToken.mockRejectedValue(new Error('secret missing'))

    const res = await GET(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.user.id).toBe('u1')
    expect('sessionToken' in body).toBe(false)
  })
})

describe('GET /api/v1/auth/mobile-session — database path (task 1e0eddcb)', () => {
  beforeEach(() => {
    decode.mockResolvedValue(null) // force the DB branch
  })

  it('extends a stale database session', async () => {
    const staleExpiry = new Date((NOW() + SESSION_MAX_AGE_SECONDS - 25 * 60 * 60) * 1000)
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 's1', expires: staleExpiry,
      user: { id: 'u1', email: 'u@example.com', name: 'U', image: null },
    } as never)

    const body = await (await GET(req())).json()

    expect(mockPrisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' } }),
    )
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(staleExpiry.getTime())
  })

  it('leaves a fresh database session alone', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 's1', expires: new Date((NOW() + SESSION_MAX_AGE_SECONDS) * 1000),
      user: { id: 'u1', email: 'u@example.com', name: 'U', image: null },
    } as never)

    await GET(req())

    expect(mockPrisma.session.update).not.toHaveBeenCalled()
  })

  it('still deletes and 401s an expired database session', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 's1', expires: new Date(Date.now() - 1000),
      user: { id: 'u1', email: 'u@example.com', name: 'U', image: null },
    } as never)

    const res = await GET(req())

    expect(res.status).toBe(401)
    expect(mockPrisma.session.delete).toHaveBeenCalled()
    expect(mockPrisma.session.update).not.toHaveBeenCalled()
  })

  it('serves the session anyway when the extension write fails', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 's1', expires: new Date((NOW() + SESSION_MAX_AGE_SECONDS - 25 * 60 * 60) * 1000),
      user: { id: 'u1', email: 'u@example.com', name: 'U', image: null },
    } as never)
    mockPrisma.session.update.mockRejectedValue(new Error('db down') as never)

    const res = await GET(req())

    expect(res.status).toBe(200)
    expect((await res.json()).user.id).toBe('u1')
  })
})
