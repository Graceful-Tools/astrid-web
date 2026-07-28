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
