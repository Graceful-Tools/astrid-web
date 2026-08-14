/**
 * Task 1e0eddcb — mobile sessions must slide, like web sessions already do.
 *
 * The rules under test are the ones that make this safe to put in an auth path:
 * an expired session is never renewed, claims survive renewal, and the cadence
 * matches NextAuth's own so a launch does not re-mint on every call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next-auth/jwt', () => ({
  encode: vi.fn(async ({ token }: { token: Record<string, unknown> }) =>
    `encoded:${JSON.stringify(token)}`),
}))

import {
  shouldRenewSession,
  renewSessionToken,
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from '@/lib/mobile-session-renewal'
import { encode } from 'next-auth/jwt'

const NOW = 1_800_000_000

describe('shouldRenewSession (task 1e0eddcb)', () => {
  it('does NOT renew a session that just started', () => {
    // Freshly signed in: full 30 days left, nothing to do.
    const exp = NOW + SESSION_MAX_AGE_SECONDS
    expect(shouldRenewSession(exp, NOW)).toBe(false)
  })

  it('renews once the session is older than the update age', () => {
    // 25 hours old → past the 24h update age.
    const exp = NOW + SESSION_MAX_AGE_SECONDS - 25 * 60 * 60
    expect(shouldRenewSession(exp, NOW)).toBe(true)
  })

  it('does not renew just before the update age', () => {
    // 23 hours old — still inside the window, so a launch does not re-mint.
    const exp = NOW + SESSION_MAX_AGE_SECONDS - 23 * 60 * 60
    expect(shouldRenewSession(exp, NOW)).toBe(false)
  })

  it('renews a session that is nearly expired', () => {
    const exp = NOW + 60 // one minute left
    expect(shouldRenewSession(exp, NOW)).toBe(true)
  })

  it('NEVER renews an expired session', () => {
    // The load-bearing rule. Renewing an expired token would turn a sign-out
    // into an indefinite session and defeat the expiry entirely.
    expect(shouldRenewSession(NOW - 1, NOW)).toBe(false)
    expect(shouldRenewSession(NOW - 90 * 24 * 60 * 60, NOW)).toBe(false)
  })

  it('treats exactly-now as expired, not renewable', () => {
    expect(shouldRenewSession(NOW, NOW)).toBe(false)
  })

  it('honours the documented cadence constants', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60)
    expect(SESSION_UPDATE_AGE_SECONDS).toBe(24 * 60 * 60)
  })
})

describe('renewSessionToken (task 1e0eddcb)', () => {
  // Without this, `mock.calls[0]` is the PREVIOUS test's call and the claim
  // assertions below silently inspect the wrong token.
  beforeEach(() => { vi.clearAllMocks() })

  it('issues a fresh 30-day window', async () => {
    const { expiresAt } = await renewSessionToken({ id: 'u1' }, 'secret', NOW)

    expect(expiresAt.getTime()).toBe((NOW + SESSION_MAX_AGE_SECONDS) * 1000)
  })

  it('carries identity claims across unchanged', async () => {
    await renewSessionToken(
      { sub: 'u1', id: 'u1', email: 'u@example.com', name: 'U', image: null, provider: 'webauthn' },
      'secret',
      NOW,
    )

    const encoded = vi.mocked(encode).mock.calls[0][0] as unknown as {
      token: Record<string, unknown>
      maxAge: number
    }
    expect(encoded.token).toMatchObject({
      sub: 'u1', id: 'u1', email: 'u@example.com', name: 'U', image: null, provider: 'webauthn',
    })
    expect(encoded.maxAge).toBe(SESSION_MAX_AGE_SECONDS)
  })

  it('carries UNKNOWN claims across too', async () => {
    // A claim added elsewhere must not silently vanish the first time a user's
    // session renews.
    await renewSessionToken({ id: 'u1', someFutureClaim: 'keep me' }, 'secret', NOW)

    const encoded = vi.mocked(encode).mock.calls[0][0] as unknown as { token: Record<string, unknown> }
    expect(encoded.token.someFutureClaim).toBe('keep me')
  })

  it('replaces the time-based claims rather than inheriting stale ones', async () => {
    await renewSessionToken(
      { id: 'u1', iat: NOW - 100_000, exp: NOW + 10, jti: 'old-jti' },
      'secret',
      NOW,
    )

    const encoded = vi.mocked(encode).mock.calls[0][0] as unknown as { token: Record<string, unknown> }
    expect(encoded.token.iat).toBe(NOW)
    expect(encoded.token.exp).toBe(NOW + SESSION_MAX_AGE_SECONDS)
    expect(encoded.token.jti).not.toBe('old-jti')
  })
})
