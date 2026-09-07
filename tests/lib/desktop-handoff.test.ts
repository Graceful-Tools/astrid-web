/**
 * RED for the desktop browser hand-off sign-in (Astrid for Windows, M0).
 *
 * The native app cannot show a NextAuth page, so it opens the system browser,
 * the user signs in there with whatever the web already supports (passkey,
 * Google, Apple), and the browser hands a one-time code back over the app's
 * custom URL scheme. PKCE binds that code to the app instance that started the
 * flow, so a code intercepted on the way back — another local program can
 * register the same scheme — is useless without the verifier that never left
 * the app.
 *
 * This file covers the decisions that hold with no database in sight. The
 * storage half lives in tests/lib/desktop-grant-store.test.ts.
 */
import { describe, it, expect } from 'vitest'

const {
  DESKTOP_GRANT_TTL_SECONDS,
  DESKTOP_STATE_MAX_LENGTH,
  desktopClientFor,
  validateGrantRequest,
  buildDesktopCallbackUrl,
  grantExpiry,
  isGrantRedeemable,
} = await import('@/lib/auth/desktop-handoff')

/** A syntactically valid S256 challenge: sha256 → base64url is always 43 chars. */
const CHALLENGE = 'a'.repeat(43)

function grantInput(overrides: Record<string, unknown> = {}) {
  return {
    client: 'windows',
    state: 'state-123',
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    ...overrides,
  }
}

describe('desktop client registry', () => {
  it('knows the Windows app', () => {
    expect(desktopClientFor('windows')?.id).toBe('windows')
  })

  it('refuses a client it does not know', () => {
    expect(desktopClientFor('linux')).toBeNull()
    expect(desktopClientFor('')).toBeNull()
    expect(desktopClientFor(undefined)).toBeNull()
    expect(desktopClientFor(42)).toBeNull()
  })

  it('carries a redirect URI on the app scheme, not an http one', () => {
    const client = desktopClientFor('windows')!
    expect(client.redirectUri.endsWith('://auth/callback')).toBe(true)
    expect(client.redirectUri.startsWith('http')).toBe(false)
  })
})

describe('grant request validation', () => {
  it('accepts a well-formed request', () => {
    const result = validateGrantRequest(grantInput())
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.client.id).toBe('windows')
      expect(result.value.state).toBe('state-123')
      expect(result.value.codeChallenge).toBe(CHALLENGE)
    }
  })

  it('refuses `plain` PKCE, which is no binding at all', () => {
    // A plain challenge equals the verifier, so anyone who intercepts the
    // callback URL can redeem it. S256 is the only method this flow accepts.
    const result = validateGrantRequest(grantInput({ codeChallengeMethod: 'plain' }))
    expect(result.ok).toBe(false)
  })

  it('refuses a missing challenge method rather than assuming S256', () => {
    expect(validateGrantRequest(grantInput({ codeChallengeMethod: undefined })).ok).toBe(false)
  })

  it('refuses a challenge that is not base64url of the right length', () => {
    expect(validateGrantRequest(grantInput({ codeChallenge: 'short' })).ok).toBe(false)
    expect(validateGrantRequest(grantInput({ codeChallenge: 'a'.repeat(129) })).ok).toBe(false)
    // `+` and `/` are base64, not base64url — a client sending them has the
    // wrong encoding and its verifier will never match.
    expect(validateGrantRequest(grantInput({ codeChallenge: 'a'.repeat(42) + '+' })).ok).toBe(false)
    expect(validateGrantRequest(grantInput({ codeChallenge: 'a'.repeat(42) + '=' })).ok).toBe(false)
  })

  it('requires a state, and caps how long it can be', () => {
    expect(validateGrantRequest(grantInput({ state: '' })).ok).toBe(false)
    expect(validateGrantRequest(grantInput({ state: undefined })).ok).toBe(false)
    expect(validateGrantRequest(grantInput({ state: 'a'.repeat(DESKTOP_STATE_MAX_LENGTH) })).ok).toBe(true)
    expect(validateGrantRequest(grantInput({ state: 'a'.repeat(DESKTOP_STATE_MAX_LENGTH + 1) })).ok).toBe(false)
  })

  it('refuses an unknown client', () => {
    expect(validateGrantRequest(grantInput({ client: 'android' })).ok).toBe(false)
  })

  it('ignores a redirect URI supplied by the caller', () => {
    // The whole open-redirect class is closed by never reading a redirect from
    // the request. If this ever starts honouring one, a phishing page could
    // hand a real code to an attacker's app.
    const result = validateGrantRequest(
      grantInput({ redirectUri: 'https://evil.test/steal' }) as Record<string, unknown>,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.client.redirectUri).not.toContain('evil.test')
    }
  })
})

describe('callback URL', () => {
  it('carries the code and echoes the state', () => {
    const client = desktopClientFor('windows')!
    const url = new URL(buildDesktopCallbackUrl(client, { code: 'abc123', state: 'state-123' }))
    expect(url.searchParams.get('code')).toBe('abc123')
    expect(url.searchParams.get('state')).toBe('state-123')
  })

  it('encodes a state that would otherwise inject query parameters', () => {
    const client = desktopClientFor('windows')!
    const hostile = 'x&code=attacker-code&y= #frag'
    const url = new URL(buildDesktopCallbackUrl(client, { code: 'real-code', state: hostile }))
    // The app must still read the real code, not the one smuggled in `state`.
    expect(url.searchParams.get('code')).toBe('real-code')
    expect(url.searchParams.get('state')).toBe(hostile)
  })

  it('stays on the app scheme whatever the inputs', () => {
    const client = desktopClientFor('windows')!
    const url = buildDesktopCallbackUrl(client, { code: '../../evil', state: '//evil.test' })
    expect(url.startsWith(client.redirectUri + '?')).toBe(true)
  })
})

describe('grant lifetime', () => {
  const now = new Date('2026-09-07T12:00:00Z')

  it('expires five minutes out', () => {
    expect(DESKTOP_GRANT_TTL_SECONDS).toBe(300)
    expect(grantExpiry(now).toISOString()).toBe('2026-09-07T12:05:00.000Z')
  })

  it('is redeemable while unused and unexpired', () => {
    expect(isGrantRedeemable({ expiresAt: grantExpiry(now), usedAt: null }, now)).toBe(true)
  })

  it('is not redeemable once used', () => {
    expect(isGrantRedeemable({ expiresAt: grantExpiry(now), usedAt: now }, now)).toBe(false)
  })

  it('is not redeemable once expired, and expiry is exclusive at the boundary', () => {
    const expiresAt = grantExpiry(now)
    expect(isGrantRedeemable({ expiresAt, usedAt: null }, expiresAt)).toBe(false)
    expect(isGrantRedeemable({ expiresAt, usedAt: null }, new Date(expiresAt.getTime() + 1))).toBe(false)
  })
})

describe('session cookie name', () => {
  it('follows the environment split in lib/auth-config.ts', async () => {
    const { sessionCookieNameFor } = await import('@/lib/auth/desktop-handoff')
    // A native client picks a name before it has ever seen a server cookie, so
    // this has to match what NextAuth actually issues or the very first
    // authenticated request after sign-in reads as signed out.
    expect(sessionCookieNameFor(true)).toBe('__Secure-next-auth.session-token')
    expect(sessionCookieNameFor(false)).toBe('next-auth.session-token')
  })
})
