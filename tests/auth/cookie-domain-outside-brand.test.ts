/**
 * ADEV-96 — a session cookie whose Domain does not cover the serving host is
 * dropped by the browser, so sign-in "succeeds" and the user stays signed out.
 */
import { describe, it, expect } from 'vitest'
import { authCookieDomain, authSessionCookie } from '@/lib/auth/secure-cookies'

describe('ADEV-96 auth cookie domain', () => {
  it('is host-only when NEXTAUTH_URL is outside the brand domain', () => {
    const env = { NEXTAUTH_URL: 'https://app.azurecontainerapps.io' }
    expect(authCookieDomain(env, 'tasks.acme.example')).toBeUndefined()
    expect(authSessionCookie(env).options.domain).toBeUndefined()
  })
  it('keeps the brand domain for the apex, www and subdomains', () => {
    for (const url of ['https://astrid.cc', 'https://www.astrid.cc', 'https://x.astrid.cc']) {
      expect(authCookieDomain({ NEXTAUTH_URL: url }, 'astrid.cc')).toBe('.astrid.cc')
    }
  })
  it('does not treat a lookalike host as a subdomain', () => {
    expect(authCookieDomain({ NEXTAUTH_URL: 'https://evilastrid.cc' }, 'astrid.cc')).toBeUndefined()
  })
  it('keeps the brand domain when NEXTAUTH_URL is unset', () => {
    expect(authCookieDomain({}, 'astrid.cc')).toBe('.astrid.cc')
  })
})
