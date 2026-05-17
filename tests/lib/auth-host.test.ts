/**
 * Task e1213d6f — Google sign-in fails with redirect_uri_mismatch on
 * preview subdomains (e.g. feature-x.astrid.cc) because NextAuth builds
 * the OAuth redirect_uri from the request host, and only astrid.cc is
 * whitelisted in Google Cloud.
 *
 * These pin the host-routing helper that bounces preview sign-in to the
 * canonical host and lets a signed-in user return to the preview.
 */
import { describe, it, expect } from 'vitest'
import {
  isCanonicalAuthHost,
  planGoogleSignIn,
  isAstridSubdomainUrl,
} from '@/lib/auth-host'

describe('isCanonicalAuthHost', () => {
  it('is true for the production hosts where Google OAuth is whitelisted', () => {
    expect(isCanonicalAuthHost('astrid.cc')).toBe(true)
    expect(isCanonicalAuthHost('www.astrid.cc')).toBe(true)
  })

  it('is true for local development hosts', () => {
    expect(isCanonicalAuthHost('localhost')).toBe(true)
    expect(isCanonicalAuthHost('localhost:3000')).toBe(true)
    expect(isCanonicalAuthHost('127.0.0.1:3000')).toBe(true)
  })

  it('is false for preview subdomains', () => {
    expect(isCanonicalAuthHost('feature-x.astrid.cc')).toBe(false)
    expect(isCanonicalAuthHost('per-user-status-lists.astrid.cc')).toBe(false)
  })

  it('is false for raw vercel deployment hosts', () => {
    expect(isCanonicalAuthHost('astrid-abc123-gracefultools.vercel.app')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isCanonicalAuthHost('Astrid.CC')).toBe(true)
  })
})

describe('planGoogleSignIn', () => {
  it('signs in directly on a canonical host', () => {
    expect(planGoogleSignIn('https://astrid.cc/auth/signin')).toEqual({ mode: 'direct' })
    expect(planGoogleSignIn('http://localhost:3000/auth/signin')).toEqual({ mode: 'direct' })
  })

  it('bounces a preview subdomain to the canonical sign-in page', () => {
    const plan = planGoogleSignIn('https://feature-x.astrid.cc/auth/signin')
    expect(plan.mode).toBe('redirect')
    if (plan.mode === 'redirect') {
      expect(plan.url).toBe(
        'https://astrid.cc/auth/signin?callbackUrl=' +
          encodeURIComponent('https://feature-x.astrid.cc/'),
      )
    }
  })

  it('passes the preview origin (not the full path) as callbackUrl', () => {
    const plan = planGoogleSignIn('https://feature-x.astrid.cc/lists/abc?task=1')
    expect(plan.mode).toBe('redirect')
    if (plan.mode === 'redirect') {
      expect(plan.url).toContain(encodeURIComponent('https://feature-x.astrid.cc/'))
    }
  })

  it('falls back to direct mode for an unparseable origin', () => {
    expect(planGoogleSignIn('not a url')).toEqual({ mode: 'direct' })
  })
})

describe('isAstridSubdomainUrl', () => {
  it('accepts astrid.cc and any https subdomain', () => {
    expect(isAstridSubdomainUrl('https://astrid.cc/')).toBe(true)
    expect(isAstridSubdomainUrl('https://www.astrid.cc/lists')).toBe(true)
    expect(isAstridSubdomainUrl('https://feature-x.astrid.cc/')).toBe(true)
  })

  it('rejects non-https astrid urls', () => {
    expect(isAstridSubdomainUrl('http://feature-x.astrid.cc/')).toBe(false)
  })

  it('rejects look-alike domains (no open redirect)', () => {
    expect(isAstridSubdomainUrl('https://astrid.cc.evil.com/')).toBe(false)
    expect(isAstridSubdomainUrl('https://evil-astrid.cc/')).toBe(false)
    expect(isAstridSubdomainUrl('https://notastrid.cc/')).toBe(false)
    expect(isAstridSubdomainUrl('https://xastrid.cc/')).toBe(false)
  })

  it('rejects garbage input', () => {
    expect(isAstridSubdomainUrl('')).toBe(false)
    expect(isAstridSubdomainUrl('/relative/path')).toBe(false)
  })
})
