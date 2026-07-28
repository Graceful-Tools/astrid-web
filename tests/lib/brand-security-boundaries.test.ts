/**
 * Whitelabel (task 97208a72) — the brand-derived security boundaries.
 *
 * Three checks changed from a hardcoded `astrid.cc` to `BRAND.domain`. In each the
 * LEADING DOT of the subdomain suffix is load-bearing: matching `endsWith(domain)`
 * alone would also accept an attacker-registered lookalike like `evil-astrid.cc`.
 * That mistake is invisible in review and in normal use — it only shows up as an open
 * redirect or an accepted WebAuthn origin — so it is pinned here for both the default
 * brand and a rebranded one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('auth-host redirect boundary (task 97208a72)', () => {
  it('accepts the brand domain and its subdomains', async () => {
    const { isAstridSubdomainUrl } = await import('@/lib/auth-host')

    expect(isAstridSubdomainUrl('https://astrid.cc/')).toBe(true)
    expect(isAstridSubdomainUrl('https://www.astrid.cc/')).toBe(true)
    expect(isAstridSubdomainUrl('https://feature-x.astrid.cc/')).toBe(true)
  })

  it('rejects lookalike domains that merely end with the brand domain', async () => {
    const { isAstridSubdomainUrl } = await import('@/lib/auth-host')

    // Without the leading dot in the suffix, every one of these would pass.
    expect(isAstridSubdomainUrl('https://evil-astrid.cc/')).toBe(false)
    expect(isAstridSubdomainUrl('https://notastrid.cc/')).toBe(false)
    expect(isAstridSubdomainUrl('https://astrid.cc.evil.example/')).toBe(false)
  })

  it('rejects non-https origins', async () => {
    const { isAstridSubdomainUrl } = await import('@/lib/auth-host')

    expect(isAstridSubdomainUrl('http://astrid.cc/')).toBe(false)
    expect(isAstridSubdomainUrl('javascript:alert(1)')).toBe(false)
    expect(isAstridSubdomainUrl('not a url')).toBe(false)
  })

  it('follows a rebranded domain, and still rejects that brand’s lookalikes', async () => {
    const ORIGINAL = { ...process.env }
    try {
      vi.resetModules()
      process.env.NEXT_PUBLIC_BRAND_DOMAIN = 'acme.example'
      const { isAstridSubdomainUrl } = await import('@/lib/auth-host')

      expect(isAstridSubdomainUrl('https://acme.example/')).toBe(true)
      expect(isAstridSubdomainUrl('https://preview.acme.example/')).toBe(true)
      expect(isAstridSubdomainUrl('https://evil-acme.example/')).toBe(false)
      // The old brand must no longer be trusted by a rebranded deployment.
      expect(isAstridSubdomainUrl('https://astrid.cc/')).toBe(false)
    } finally {
      process.env = { ...ORIGINAL }
      vi.resetModules()
    }
  })
})

describe('canonical auth host (task 97208a72)', () => {
  it('accepts the apex, www and local development hosts only', async () => {
    const { isCanonicalAuthHost } = await import('@/lib/auth-host')

    expect(isCanonicalAuthHost('astrid.cc')).toBe(true)
    expect(isCanonicalAuthHost('www.astrid.cc')).toBe(true)
    expect(isCanonicalAuthHost('localhost:3000')).toBe(true)
    // A preview subdomain is NOT canonical — it redirects through the apex, which is
    // the whole reason this function exists.
    expect(isCanonicalAuthHost('feature-x.astrid.cc')).toBe(false)
    expect(isCanonicalAuthHost('evil-astrid.cc')).toBe(false)
  })
})

describe('WebAuthn relying party (task 97208a72)', () => {
  const ORIGINAL = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.resetModules()
  })

  it('treats only real subdomains of the brand domain as expected origins', async () => {
    process.env.NODE_ENV = 'production'
    const { getExpectedOrigins } = await import('@/lib/webauthn')

    expect(getExpectedOrigins('https://preview.astrid.cc')).toContain('https://preview.astrid.cc')
    // A lookalike must not be added to the expected-origin list.
    expect(getExpectedOrigins('https://evil-astrid.cc')).not.toContain('https://evil-astrid.cc')
    expect(getExpectedOrigins('http://preview.astrid.cc')).not.toContain('http://preview.astrid.cc')
  })
})

/**
 * Regression: the Acme preview failed every passkey call with "invalid for this domain".
 *
 * BRAND.domain is the brand's NOMINAL domain and is not necessarily where the app is
 * served. The preview ran on *.vercel.app while claiming an RP ID of tasks.acme.example,
 * and WebAuthn requires the RP ID to be the origin's host or a registrable suffix of it.
 *
 * The RP ID is a credential binding, so the fix must NOT move it for Astrid: served from
 * www.astrid.cc, a subdomain of astrid.cc, it has to stay astrid.cc or every registered
 * passkey stops working.
 */
describe('WebAuthn RP ID tracks the serving host (task 97208a72)', () => {
  const ORIGINAL = { ...process.env }

  async function rpIDFor(env: Record<string, string | undefined>, requestOrigin?: string) {
    vi.resetModules()
    for (const key of ['NEXTAUTH_URL', 'VERCEL_URL', 'NEXT_PUBLIC_BRAND_DOMAIN',
                       'NEXT_PUBLIC_BRAND_WEBAUTHN_RP_ID', 'NODE_ENV']) {
      delete (process.env as Record<string, string | undefined>)[key]
    }
    Object.assign(process.env, env)
    return (await import('@/lib/webauthn')).resolveRpID(requestOrigin)
  }

  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.resetModules()
  })

  it('stays astrid.cc for production — passkeys must not be invalidated', async () => {
    expect(await rpIDFor({ NODE_ENV: 'production', NEXTAUTH_URL: 'https://www.astrid.cc' }))
      .toBe('astrid.cc')
  })

  it('uses the serving host when the brand domain is not where we are served', async () => {
    // The exact Acme preview failure.
    expect(await rpIDFor({
      NODE_ENV: 'production',
      NEXTAUTH_URL: 'https://astrid-abc123-gracefultools.vercel.app',
      NEXT_PUBLIC_BRAND_DOMAIN: 'tasks.acme.example',
    })).toBe('astrid-abc123-gracefultools.vercel.app')
  })

  it('uses the brand domain once the deployment is actually served from it', async () => {
    expect(await rpIDFor({
      NODE_ENV: 'production',
      NEXTAUTH_URL: 'https://tasks.acme.example',
      NEXT_PUBLIC_BRAND_DOMAIN: 'tasks.acme.example',
    })).toBe('tasks.acme.example')
  })

  it('does not treat a lookalike host as the brand domain', async () => {
    // evil-astrid.cc must scope credentials to itself, never to astrid.cc.
    expect(await rpIDFor({ NODE_ENV: 'production', NEXTAUTH_URL: 'https://evil-astrid.cc' }))
      .toBe('evil-astrid.cc')
  })

  it('prefers the request origin over the environment', async () => {
    // The failure this exists for: on a preview, NEXTAUTH_URL still points at
    // production, so an env-derived RP ID does not match the host the browser is on and
    // every passkey call is rejected. The request origin is the authority.
    expect(await rpIDFor(
      { NODE_ENV: 'production', NEXTAUTH_URL: 'https://www.astrid.cc',
        NEXT_PUBLIC_BRAND_DOMAIN: 'tasks.acme.example' },
      'https://astrid-preview-abc.vercel.app',
    )).toBe('astrid-preview-abc.vercel.app')
  })

  it('still collapses a brand subdomain request to the brand domain', async () => {
    // A request arriving on preview.astrid.cc must keep RP ID astrid.cc, or a passkey
    // registered on the apex would not be offered.
    expect(await rpIDFor(
      { NODE_ENV: 'production', NEXTAUTH_URL: 'https://www.astrid.cc' },
      'https://preview.astrid.cc',
    )).toBe('astrid.cc')
  })

  it('falls back to the environment when there is no request origin', async () => {
    expect(await rpIDFor({ NODE_ENV: 'production', NEXTAUTH_URL: 'https://www.astrid.cc' }))
      .toBe('astrid.cc')
  })

  it('honours an explicit override', async () => {
    expect(await rpIDFor({
      NODE_ENV: 'production',
      NEXTAUTH_URL: 'https://astrid-abc.vercel.app',
      NEXT_PUBLIC_BRAND_WEBAUTHN_RP_ID: 'tasks.acme.example',
    })).toBe('tasks.acme.example')
  })

  it('stays localhost in development', async () => {
    expect(await rpIDFor({ NODE_ENV: 'development' })).toBe('localhost')
  })
})
