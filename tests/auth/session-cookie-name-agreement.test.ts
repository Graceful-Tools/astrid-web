/**
 * AWTD-1248 — the cookie name `getServerSession` reads must be the one
 * `getToken` reads.
 *
 * `lib/auth-config.ts` chose `__Secure-` names on `NODE_ENV === "production"`
 * alone. NextAuth chooses from the URL scheme. A production build over plain
 * http — CI's `next start`, a local production build — made the two disagree,
 * so `withAuth` routes authenticated and the `getUnifiedSession()` routes
 * returned 401 for the same browser.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { BRAND } from '@/lib/brand/config'
import {
  authSessionCookie,
  authSessionCookieName,
  usesSecureAuthCookies,
} from '@/lib/auth/secure-cookies'

/** A partner build asserts THEIR domain, so never the literal. */
const HTTPS_ORIGIN = `https://${BRAND.domain}`

async function loadAuthConfig() {
  vi.resetModules()
  return (await import('@/lib/auth-config')).authConfig
}

/**
 * What `getServerSession` will actually look for: our override when we set
 * one, otherwise NextAuth's own default for the same environment.
 */
function serverSessionCookieName(cookies: { sessionToken?: { name?: string } } | undefined) {
  return cookies?.sessionToken?.name ?? authSessionCookieName()
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('usesSecureAuthCookies follows the scheme, as NextAuth does', () => {
  it('is true over https', () => {
    expect(usesSecureAuthCookies({ NEXTAUTH_URL: HTTPS_ORIGIN })).toBe(true)
  })

  it('is false over plain http', () => {
    expect(usesSecureAuthCookies({ NEXTAUTH_URL: 'http://localhost:3000' })).toBe(false)
  })

  it('falls back to Vercel when the URL is unset, so production stays secure', () => {
    expect(usesSecureAuthCookies({ VERCEL: '1' })).toBe(true)
    expect(usesSecureAuthCookies({})).toBe(false)
  })

  it('names the cookie to match', () => {
    expect(authSessionCookieName({ NEXTAUTH_URL: HTTPS_ORIGIN }))
      .toBe('__Secure-next-auth.session-token')
    expect(authSessionCookieName({ NEXTAUTH_URL: 'http://localhost:3000' }))
      .toBe('next-auth.session-token')
  })
})

describe('authConfig agrees with getToken about the cookie name', () => {
  it('keeps __Secure- names and the shared domain in production over https', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', HTTPS_ORIGIN)

    const cookies = (await loadAuthConfig()).cookies
    expect(cookies?.sessionToken?.name).toBe('__Secure-next-auth.session-token')
    expect(cookies?.sessionToken?.options?.secure).toBe(true)
    // www and non-www share the session; dropping this signs users out.
    expect(cookies?.sessionToken?.options?.domain).toMatch(/^\./)
    expect(serverSessionCookieName(cookies)).toBe(authSessionCookieName())
  })

  it('still agrees when NEXTAUTH_URL is unset and auth-config fills it in', async () => {
    // auth-config assigns process.env.NEXTAUTH_URL from getBaseUrl() at import
    // time, before anything reads it — so the two sides must agree about
    // whatever that produced, not about what the deployment was configured
    // with. Production resolves to https there; this asserts the agreement
    // rather than the value, which depends on the surrounding environment.
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', undefined)
    vi.stubEnv('VERCEL', '1')

    const cookies = (await loadAuthConfig()).cookies
    expect(serverSessionCookieName(cookies)).toBe(authSessionCookieName())
  })

  it('does not ask for a __Secure- cookie a plain-http origin can never send', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')
    vi.stubEnv('VERCEL', undefined)

    const cookies = (await loadAuthConfig()).cookies
    expect(serverSessionCookieName(cookies)).toBe('next-auth.session-token')
  })

  it('leaves development on NextAuth defaults', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000')

    expect((await loadAuthConfig()).cookies).toBeUndefined()
  })
})

describe('a hand-written session cookie carries what the readers expect', () => {
  it('matches the read name, and only claims the shared domain over https', () => {
    const https = authSessionCookie({ NEXTAUTH_URL: HTTPS_ORIGIN })
    expect(https.name).toBe(authSessionCookieName({ NEXTAUTH_URL: HTTPS_ORIGIN }))
    expect(https.options.secure).toBe(true)
    expect(https.options.domain).toMatch(/^\./)

    const http = authSessionCookie({ NEXTAUTH_URL: 'http://localhost:3000' })
    expect(http.name).toBe('next-auth.session-token')
    expect(http.options.secure).toBe(false)
    // A `__Secure-`-less cookie with a leading-dot domain over http is a pair
    // the browser rejects, so the passkey sign-in would set nothing at all.
    expect(http.options.domain).toBeUndefined()
  })

  it('is the cookie both passkey verify routes set', async () => {
    const routes = [
      'app/api/auth/webauthn/authenticate/verify/route.ts',
      'app/api/auth/webauthn/register/verify/route.ts',
    ]
    const { readFile } = await import('node:fs/promises')
    for (const route of routes) {
      const source = await readFile(route, 'utf8')
      expect(source).toContain('authSessionCookie()')
      // The name was decided locally from a broader production signal than the
      // readers use, in a block duplicated across both routes (AWTD-1248).
      expect(source).not.toContain('__Secure-next-auth.session-token')
    }
  })
})
