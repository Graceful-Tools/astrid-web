// @vitest-environment node
// Real next-auth/jwt encode/decode: jose's encryption rejects jsdom's Uint8Array.
/**
 * AWTD-1104 — the four native (iOS) sign-in routes share one linking rule and
 * one session format.
 *
 * /api/auth/{apple,google} and /api/v1/auth/{apple,google} each carried their
 * own find-user / link / adopt / mint-session copy. Google's never looked the
 * identity up by its Google account id first, so a returning user whose email
 * had moved to another row signed in as that row. And all four minted a
 * database `Session` row, while passkey and desktop issue the NextAuth JWT —
 * two formats for every reader to understand (spec §6.3, §6.5).
 *
 * What this pins, for every route:
 *   - the session is a NextAuth JWT naming the right user; no Session row;
 *   - it is set under the cookie name these routes have always used, and the
 *     body states it, as /api/v1/auth/desktop/exchange does;
 *   - the identity is found by provider account id before the email.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { decode } from 'next-auth/jwt'

vi.mock('@/lib/brand/capabilities', () => ({ capabilityGate: vi.fn(() => null), CAPABILITIES: {} }))
vi.mock('@/lib/rate-limiter', () => ({
  withRateLimitHandlerAsync: (handler: unknown) => handler,
  authRateLimiter: {},
}))
vi.mock('@/lib/default-lists', () => ({ createDefaultListsForUser: vi.fn() }))

const jwtVerify = vi.hoisted(() => vi.fn())
vi.mock('jose', async (importOriginal) => ({
  ...(await importOriginal<typeof import('jose')>()),
  createRemoteJWKSet: vi.fn(() => ({})),
  jwtVerify,
}))

const prisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  account: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
  authenticator: { deleteMany: vi.fn() },
  session: { create: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma }))

import { POST as legacyGoogle } from '@/app/api/auth/google/route'
import { POST as v1Google } from '@/app/api/v1/auth/google/route'
import { POST as legacyApple } from '@/app/api/auth/apple/route'
import { POST as v1Apple } from '@/app/api/v1/auth/apple/route'
import { googleAllowedAudiences } from '@/lib/auth/google-identity'

type Handler = (req: NextRequest) => Promise<Response>

const linkedUser = { id: 'u1', email: 'dev@example.com', name: 'Dev', image: null, emailVerified: new Date(), isAIAgent: false }
const emailOwner = { ...linkedUser, id: 'someone-else', accounts: [] }

const routes: Array<{ name: string; provider: 'google' | 'apple'; path: string; handler: Handler; body: object }> = [
  { name: 'POST /api/auth/google', provider: 'google', path: '/api/auth/google', handler: legacyGoogle as Handler, body: { idToken: 'g-id-token' } },
  { name: 'POST /api/v1/auth/google', provider: 'google', path: '/api/v1/auth/google', handler: v1Google as Handler, body: { idToken: 'g-id-token' } },
  { name: 'POST /api/auth/apple', provider: 'apple', path: '/api/auth/apple', handler: legacyApple as Handler, body: { identityToken: 'a-id-token' } },
  { name: 'POST /api/v1/auth/apple', provider: 'apple', path: '/api/v1/auth/apple', handler: v1Apple as Handler, body: { identityToken: 'a-id-token' } },
]

function req(path: string, body: object) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({
      sub: 'provider-sub', email: 'dev@example.com', email_verified: 'true',
      aud: googleAllowedAudiences()[0], name: 'Dev',
    }), { status: 200 }),
  ))
  jwtVerify.mockResolvedValue({ payload: { sub: 'provider-sub', email: 'dev@example.com', email_verified: true } })

  // The identity is u1's; the email now belongs to a different row.
  prisma.account.findUnique.mockResolvedValue({ id: 'acc', userId: 'u1' })
  prisma.account.findFirst.mockResolvedValue({ id: 'acc', userId: 'u1' })
  prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id?: string } }) =>
    where.id === 'u1' ? linkedUser : emailOwner,
  )
  prisma.user.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: object }) =>
    ({ ...(where.id === 'u1' ? linkedUser : emailOwner), ...data }),
  )
  prisma.session.create.mockResolvedValue({ sessionToken: 'db-session-token' })
})

describe.each(routes)('AWTD-1104: $name', ({ provider, path, handler, body }) => {
  it('signs the identity in as the user it is linked to, not the owner of its email', async () => {
    const res = await handler(req(path, body))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.user.id).toBe('u1')
  })

  it('issues the NextAuth JWT session, not a database Session row', async () => {
    const res = await handler(req(path, body))
    const json = await res.json()

    expect(prisma.session.create).not.toHaveBeenCalled()

    const cookie = (res as unknown as { cookies: { get(n: string): { value: string } | undefined } })
      .cookies.get('next-auth.session-token')
    expect(cookie?.value).toBeTruthy()
    const claims = await decode({ token: cookie!.value, secret: process.env.NEXTAUTH_SECRET! })
    expect(claims).toMatchObject({ id: 'u1', sub: 'u1', email: 'dev@example.com', provider })

    expect(json).toMatchObject({
      sessionToken: cookie!.value,
      sessionCookieName: 'next-auth.session-token',
      expiresAt: expect.any(String),
    })
  })

  it('refuses an unknown identity whose email is unverified', async () => {
    prisma.account.findUnique.mockResolvedValue(null)
    prisma.account.findFirst.mockResolvedValue(null)
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ sub: 'provider-sub', email: 'dev@example.com', email_verified: 'false', aud: googleAllowedAudiences()[0] }), { status: 200 }),
    ))
    jwtVerify.mockResolvedValue({ payload: { sub: 'provider-sub', email: 'dev@example.com', email_verified: false } })

    const res = await handler(req(path, body))

    expect(res.status).toBe(401)
    expect(prisma.account.create).not.toHaveBeenCalled()
    expect(prisma.user.create).not.toHaveBeenCalled()
  })
})
