// @vitest-environment node
// Real next-auth/jwt encode/decode: jose's encryption rejects jsdom's Uint8Array.
/**
 * AWTD-1104 — the API's own cookie fallback must accept the JWT the native
 * sign-in routes now issue under `next-auth.session-token`, which
 * getServerSession does not read in production, and keep accepting the
 * database sessions they issued before, until those expire.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encode } from 'next-auth/jwt'

const prisma = vi.hoisted(() => ({ session: { findUnique: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma }))

import { sessionFromCookieValue } from '@/lib/auth/session-cookie'

const secret = process.env.NEXTAUTH_SECRET!
const now = () => Math.floor(Date.now() / 1000)

describe('sessionFromCookieValue (AWTD-1104)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prisma.session.findUnique.mockResolvedValue(null)
  })

  it('AWTD-1104: reads a NextAuth JWT without touching the Session table', async () => {
    const token = await encode({ token: { id: 'u1', sub: 'u1', email: 'dev@example.com', name: 'Dev', exp: now() + 3600 }, secret })

    await expect(sessionFromCookieValue(token)).resolves.toMatchObject({ user: { id: 'u1', email: 'dev@example.com', name: 'Dev' } })
    expect(prisma.session.findUnique).not.toHaveBeenCalled()
  })

  it('AWTD-1104: refuses an expired JWT', async () => {
    // encode sets exp from maxAge, overriding any exp in the claims.
    const token = await encode({ token: { id: 'u1' }, secret, maxAge: -10 })
    await expect(sessionFromCookieValue(token)).resolves.toBeNull()
  })

  it('AWTD-1104: still accepts a live database session issued before the switch', async () => {
    prisma.session.findUnique.mockResolvedValue({
      expires: new Date(Date.now() + 60_000),
      user: { id: 'u1', email: 'dev@example.com', name: null, image: null },
    })
    await expect(sessionFromCookieValue('google-abc')).resolves.toMatchObject({ user: { id: 'u1' } })
  })

  it('AWTD-1104: refuses an expired database session', async () => {
    prisma.session.findUnique.mockResolvedValue({
      expires: new Date(Date.now() - 60_000),
      user: { id: 'u1', email: 'dev@example.com', name: null, image: null },
    })
    await expect(sessionFromCookieValue('google-abc')).resolves.toBeNull()
  })
})
