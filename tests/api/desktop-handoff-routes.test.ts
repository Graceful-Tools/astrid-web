/**
 * RED for the two routes that make desktop hand-off sign-in work:
 *
 *   POST /api/auth/desktop/grant      — cookie-authenticated, mints a code
 *   POST /api/v1/auth/desktop/exchange — unauthenticated, code becomes a session
 *
 * The asymmetry is the interesting part. The grant route runs inside a
 * signed-in browser and must never mint a code for anyone but the caller. The
 * exchange route has no session at all — the code IS the credential — so every
 * guard it has is in the redemption.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'

const getUnifiedSession = vi.hoisted(() => vi.fn())
const createDesktopGrant = vi.hoisted(() => vi.fn())
const redeemDesktopGrant = vi.hoisted(() => vi.fn())
const encode = vi.hoisted(() => vi.fn())

// Mocked for the same reason tests/api/v1-mobile-session-renewal.test.ts does:
// jose rejects the Uint8Array jsdom hands it. Encoding itself is covered there;
// what matters here is which claims the route asks for.
vi.mock('next-auth/jwt', () => ({ encode, decode: vi.fn() }))
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession }))
vi.mock('@/lib/auth/desktop-grant-store', () => ({ createDesktopGrant, redeemDesktopGrant }))

const { POST: grant } = await import('@/app/api/auth/desktop/grant/route')
const { POST: exchange } = await import('@/app/api/v1/auth/desktop/exchange/route')

const CHALLENGE = 'a'.repeat(43)
const USER = { id: 'user-1', email: 'a@example.test', name: 'A', image: null }

/**
 * Rate-limit buckets are keyed on client IP and live for a minute, so every
 * request here gets a fresh address. Without this, one test spends the budget
 * of the next and the failures look like route bugs. The limiter itself has
 * its own test below.
 */
let ipCounter = 0
function post(url: string, body: unknown, ip = `10.0.0.${++ipCounter}`) {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

function grantBody(overrides: Record<string, unknown> = {}) {
  return {
    client: 'windows',
    state: 'state-123',
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_SECRET = 'test-secret-for-desktop-handoff'
  getUnifiedSession.mockResolvedValue({ user: USER })
  createDesktopGrant.mockResolvedValue('astrid_desktop_code')
  redeemDesktopGrant.mockResolvedValue({ ok: true, user: USER })
  encode.mockResolvedValue('minted.session.token')
})

describe('POST /api/auth/desktop/grant', () => {
  it('hands back a callback URL on the app scheme carrying code and state', async () => {
    const res = await grant(post('https://example.test/api/auth/desktop/grant', grantBody()))
    expect(res.status).toBe(200)

    const body = await res.json()
    const url = new URL(body.redirectUrl)
    expect(url.protocol).not.toBe('https:')
    expect(url.searchParams.get('code')).toBe('astrid_desktop_code')
    expect(url.searchParams.get('state')).toBe('state-123')
  })

  it('mints the code for the session user, never for a user named in the body', async () => {
    // Otherwise the endpoint is an account-takeover primitive: sign in as
    // anyone, ask for a code for someone else, redeem it in the app.
    await grant(
      post('https://example.test/api/auth/desktop/grant', grantBody({ userId: 'victim' })),
    )
    expect(createDesktopGrant).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1' }),
    )
  })

  it('refuses an unauthenticated caller', async () => {
    getUnifiedSession.mockResolvedValue(null)
    const res = await grant(post('https://example.test/api/auth/desktop/grant', grantBody()))
    expect(res.status).toBe(401)
    expect(createDesktopGrant).not.toHaveBeenCalled()
  })

  it('refuses `plain` PKCE and an unknown client', async () => {
    for (const bad of [{ codeChallengeMethod: 'plain' }, { client: 'toaster' }]) {
      const res = await grant(post('https://example.test/api/auth/desktop/grant', grantBody(bad)))
      expect(res.status).toBe(400)
    }
    expect(createDesktopGrant).not.toHaveBeenCalled()
  })

  it('refuses a body that is not JSON rather than throwing', async () => {
    const req = new NextRequest('https://example.test/api/auth/desktop/grant', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.1.${++ipCounter}` },
      body: 'not json',
    })
    expect((await grant(req)).status).toBe(400)
  })
})

describe('POST /api/v1/auth/desktop/exchange', () => {
  const url = 'https://example.test/api/v1/auth/desktop/exchange'

  function exchangeBody(overrides: Record<string, unknown> = {}) {
    return { client: 'windows', code: 'astrid_desktop_code', codeVerifier: 'v'.repeat(64), ...overrides }
  }

  it('returns a session token, its expiry, the user, and the cookie name to store it under', async () => {
    const res = await exchange(post(url, exchangeBody()))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.sessionToken).toBe('minted.session.token')
    expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now())
    expect(body.user).toEqual(USER)
    // The client holds a whole Cookie header and has no other way to know.
    expect(body.sessionCookieName).toBe('next-auth.session-token')
    expect(body.meta.apiVersion).toBe('v1')
  })

  it('mints the session for the user the code was redeemed for', async () => {
    // Nothing in the request body may influence identity — the code is the
    // only thing that says who this is.
    redeemDesktopGrant.mockResolvedValue({ ok: true, user: USER })
    await exchange(post(url, exchangeBody({ userId: 'victim', email: 'victim@example.test' })))

    // Identity is whatever the redemption returned, and the route passes the
    // code straight through without reading anything else from the body.
    expect(redeemDesktopGrant).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'astrid_desktop_code' }),
    )
    const claims = encode.mock.calls[0][0].token
    expect(claims.id).toBe('user-1')
    expect(claims.sub).toBe('user-1')
    expect(claims.email).toBe(USER.email)
    expect(claims.provider).toBe('desktop-handoff')
  })

  it('never sets a session cookie on the response', async () => {
    // The caller is a native app that stores the credential itself. Setting a
    // cookie here would additionally sign in whatever HTTP stack made the call.
    const res = await exchange(post(url, exchangeBody()))
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('refuses a code the store would not redeem', async () => {
    redeemDesktopGrant.mockResolvedValue({ ok: false, reason: 'invalid' })
    const res = await exchange(post(url, exchangeBody()))
    expect(res.status).toBe(400)
    expect((await res.json()).sessionToken).toBeUndefined()
  })

  it('gives the same answer for a wrong code as for a wrong verifier', async () => {
    // Distinguishable errors would tell an interceptor which half it got right.
    redeemDesktopGrant.mockResolvedValue({ ok: false, reason: 'invalid' })
    const badCode = await exchange(post(url, exchangeBody({ code: 'nope' })))
    const badVerifier = await exchange(post(url, exchangeBody({ codeVerifier: 'w'.repeat(64) })))
    expect(badCode.status).toBe(badVerifier.status)
    expect(await badCode.json()).toEqual(await badVerifier.json())
  })

  it('refuses an unknown client, a missing code and a missing verifier', async () => {
    for (const bad of [{ client: 'toaster' }, { code: undefined }, { codeVerifier: undefined }]) {
      const res = await exchange(post(url, exchangeBody(bad)))
      expect(res.status).toBe(400)
    }
    expect(redeemDesktopGrant).not.toHaveBeenCalled()
  })

  it('answers 401, not 400, when the account was deleted mid-flow', async () => {
    // Distinct from a bad code on purpose: the app should prompt a fresh
    // sign-in rather than report that its request was malformed.
    redeemDesktopGrant.mockResolvedValue({ ok: false, reason: 'account-missing' })
    const res = await exchange(post(url, exchangeBody()))
    expect(res.status).toBe(401)
  })
})

describe('rate limiting', () => {
  const url = 'https://example.test/api/v1/auth/desktop/exchange'

  it('cuts off a code-guessing loop from one address', async () => {
    // The exchange endpoint is unauthenticated by design — the code is the
    // credential — so this is the only thing standing between an interceptor
    // and unlimited attempts.
    redeemDesktopGrant.mockResolvedValue({ ok: false, reason: 'invalid' })
    const ip = '198.51.100.9'
    const body = { client: 'windows', code: 'guess', codeVerifier: 'v'.repeat(64) }

    const statuses: number[] = []
    for (let i = 0; i < 25; i++) {
      statuses.push((await exchange(post(url, body, ip))).status)
    }

    expect(statuses).toContain(429)
    // And it does not start there — a legitimate flow spends two requests.
    expect(statuses.slice(0, 2).every((s) => s === 400)).toBe(true)
  })

  it('gives the grant flow a bucket of its own, not the shared sign-in one', async () => {
    // Otherwise guessing codes here would lock the same address out of Google
    // and Apple sign-in, which key on the default bucket.
    const { desktopHandoffRateLimiter, authRateLimiter } = await import('@/lib/rate-limiter')
    expect(desktopHandoffRateLimiter).not.toBe(authRateLimiter)
  })
})
