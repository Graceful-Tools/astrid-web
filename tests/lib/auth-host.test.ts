/**
 * Task e1213d6f — Google sign-in fails with redirect_uri_mismatch on
 * preview subdomains (e.g. feature-x.astrid.cc) because NextAuth builds
 * the OAuth redirect_uri from the request host, and only astrid.cc is
 * whitelisted in Google Cloud.
 *
 * These pin the host-routing helper that bounces preview sign-in to the
 * canonical host and lets a signed-in user return to the preview.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  isCanonicalAuthHost,
  planGoogleSignIn,
  isAstridSubdomainUrl,
} from '@/lib/auth-host'
import { BRAND } from '@/lib/brand/config'

describe('isCanonicalAuthHost', () => {
  it('is true for the production hosts where Google OAuth is whitelisted', () => {
    expect(isCanonicalAuthHost(`${BRAND.domain}`)).toBe(true)
    expect(isCanonicalAuthHost(`www.${BRAND.domain}`)).toBe(true)
  })

  it('is true for local development hosts', () => {
    expect(isCanonicalAuthHost('localhost')).toBe(true)
    expect(isCanonicalAuthHost('localhost:3000')).toBe(true)
    expect(isCanonicalAuthHost('127.0.0.1:3000')).toBe(true)
  })

  it('is false for preview subdomains', () => {
    expect(isCanonicalAuthHost(`feature-x.${BRAND.domain}`)).toBe(false)
    expect(isCanonicalAuthHost(`per-user-status-lists.${BRAND.domain}`)).toBe(false)
  })

  it('is false for raw vercel deployment hosts', () => {
    expect(isCanonicalAuthHost('astrid-abc123-gracefultools.vercel.app')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isCanonicalAuthHost('Astrid.CC')).toBe(true)
  })
})

describe('planGoogleSignIn', () => {
  // These are preview deployments: the bounce is preview-only (AWTD-1469).
  beforeEach(() => vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview'))
  afterEach(() => vi.unstubAllEnvs())

  it('signs in directly on a canonical host', () => {
    expect(planGoogleSignIn(`https://${BRAND.domain}/auth/signin`)).toEqual({ mode: 'direct' })
    expect(planGoogleSignIn('http://localhost:3000/auth/signin')).toEqual({ mode: 'direct' })
  })

  it('bounces a preview subdomain to the canonical sign-in page', () => {
    const plan = planGoogleSignIn(`https://feature-x.${BRAND.domain}/auth/signin`)
    expect(plan.mode).toBe('redirect')
    if (plan.mode === 'redirect') {
      expect(plan.url).toBe(
        `https://${BRAND.domain}/auth/signin?callbackUrl=` +
          encodeURIComponent(`https://feature-x.${BRAND.domain}/`),
      )
    }
  })

  it('passes the preview origin (not the full path) as callbackUrl', () => {
    const plan = planGoogleSignIn(`https://feature-x.${BRAND.domain}/lists/abc?task=1`)
    expect(plan.mode).toBe('redirect')
    if (plan.mode === 'redirect') {
      expect(plan.url).toContain(encodeURIComponent(`https://feature-x.${BRAND.domain}/`))
    }
  })

  it('falls back to direct mode for an unparseable origin', () => {
    expect(planGoogleSignIn('not a url')).toEqual({ mode: 'direct' })
  })
})

describe('isAstridSubdomainUrl', () => {
  it(`accepts ${BRAND.domain} and any https subdomain`, () => {
    expect(isAstridSubdomainUrl(`https://${BRAND.domain}/`)).toBe(true)
    expect(isAstridSubdomainUrl(`https://www.${BRAND.domain}/lists`)).toBe(true)
    expect(isAstridSubdomainUrl(`https://feature-x.${BRAND.domain}/`)).toBe(true)
  })

  it('rejects non-https astrid urls', () => {
    expect(isAstridSubdomainUrl(`http://feature-x.${BRAND.domain}/`)).toBe(false)
  })

  it('rejects look-alike domains (no open redirect)', () => {
    expect(isAstridSubdomainUrl(`https://${BRAND.domain}.evil.com/`)).toBe(false)
    expect(isAstridSubdomainUrl(`https://evil-${BRAND.domain}/`)).toBe(false)
    expect(isAstridSubdomainUrl(`https://not${BRAND.domain}/`)).toBe(false)
    expect(isAstridSubdomainUrl(`https://x${BRAND.domain}/`)).toBe(false)
  })

  it('rejects garbage input', () => {
    expect(isAstridSubdomainUrl('')).toBe(false)
    expect(isAstridSubdomainUrl('/relative/path')).toBe(false)
  })
})

/**
 * AWTD-1469 — the astrid.cc bounce is for PREVIEWS only.
 *
 * It exists because Google's redirect URIs are fixed to the brand domain, and it
 * only works because the session cookie is `.${BRAND.domain}`-scoped, so the user
 * is signed in when they come back. A partner on their own domain (their own Vercel,
 * Azure, anywhere) shares neither: bouncing sends their users to someone else's
 * sign-in page and they never come back signed in. A partner's host signs in on
 * itself, whatever the brand domain is left at, and whatever the environment says.
 */
describe('AWTD-1469: a partner domain never bounces', () => {
  const PARTNER = 'https://tasks.partner.example'

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  function productionPartnerEnv() {
    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXTAUTH_URL', PARTNER)
  }

  it('signs in on the partner host when the brand domain is left at the default', () => {
    productionPartnerEnv()
    expect(planGoogleSignIn(`${PARTNER}/auth/signin`)).toEqual({ mode: 'direct' })
    expect(planGoogleSignIn(`${PARTNER}/lists/abc?task=1`)).toEqual({ mode: 'direct' })
  })

  it('signs in on the partner host when the brand domain is the partner host', async () => {
    productionPartnerEnv()
    vi.stubEnv('NEXT_PUBLIC_BRAND_DOMAIN', 'tasks.partner.example')
    vi.resetModules()
    const fresh = await import('@/lib/auth-host')
    expect(fresh.planGoogleSignIn(`${PARTNER}/auth/signin`)).toEqual({ mode: 'direct' })
  })

  it('still bounces a preview of the brand domain and a raw Vercel deployment', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    expect(planGoogleSignIn(`https://whitelabel.${BRAND.domain}/auth/signin`).mode).toBe('redirect')
    expect(planGoogleSignIn('https://astrid-abc123-gracefultools.vercel.app/').mode).toBe('redirect')
  })

  // Jon, 2026-11-01: a partner whose brand domain is its APEX while it serves a
  // subdomain must not be bounced to the apex either. Only a preview build bounces a
  // subdomain; in production the auth host is the request's own host.
  for (const deployEnv of ['', 'production']) {
    it(`apex brand domain, served on a subdomain, NEXT_PUBLIC_VERCEL_ENV="${deployEnv}": no bounce`, async () => {
      productionPartnerEnv()
      vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', deployEnv)
      vi.stubEnv('NEXT_PUBLIC_BRAND_DOMAIN', 'partner.example')
      vi.resetModules()
      const fresh = await import('@/lib/auth-host')
      expect(fresh.planGoogleSignIn(`${PARTNER}/auth/signin`)).toEqual({ mode: 'direct' })
    })
  }

  it('the same apex brand on a PREVIEW build still bounces (the cookie spans the apex)', async () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'preview')
    vi.stubEnv('NEXT_PUBLIC_BRAND_DOMAIN', 'partner.example')
    vi.resetModules()
    const fresh = await import('@/lib/auth-host')
    expect(fresh.planGoogleSignIn(`${PARTNER}/auth/signin`).mode).toBe('redirect')
  })
})

/**
 * AWTD-1469 — astrid.cc production is unchanged by the preview-only rule: the apex
 * and www are the hosts Google's redirect URI is registered for, so they sign in
 * directly in every environment, and a production build never bounces a subdomain.
 */
describe(`AWTD-1469: ${BRAND.domain} and www.${BRAND.domain} are unchanged`, () => {
  afterEach(() => vi.unstubAllEnvs())

  for (const deployEnv of ['production', 'preview', '']) {
    it(`${BRAND.domain} and www sign in directly (NEXT_PUBLIC_VERCEL_ENV="${deployEnv}")`, () => {
      vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', deployEnv)
      expect(planGoogleSignIn(`https://${BRAND.domain}/auth/signin`)).toEqual({ mode: 'direct' })
      expect(planGoogleSignIn(`https://www.${BRAND.domain}/auth/signin`)).toEqual({ mode: 'direct' })
    })
  }

  it('a production build does not bounce a brand subdomain', () => {
    vi.stubEnv('NEXT_PUBLIC_VERCEL_ENV', 'production')
    expect(planGoogleSignIn(`https://feature-x.${BRAND.domain}/`)).toEqual({ mode: 'direct' })
  })
})
