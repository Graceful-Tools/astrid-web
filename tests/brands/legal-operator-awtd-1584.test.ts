// @vitest-environment node
/**
 * AWTD-1584 — the legal operator follows the brand.
 *
 * Every Terms, Privacy and Help page said "Graceful Tools LLC" on every deployment, so a
 * partner's terms of service named someone else's company as the operator. The brand
 * matrix renders the pages per profile; these pin the fallback rules and the
 * external-policy switch, which no shipped profile exercises.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const KEYS = [
  'NEXT_PUBLIC_BRAND_NAME',
  'NEXT_PUBLIC_BRAND_OPERATOR_NAME',
  'NEXT_PUBLIC_BRAND_TERMS_URL',
  'NEXT_PUBLIC_BRAND_PRIVACY_URL',
]
const ORIGINAL = { ...process.env }

async function brandWith(env: Record<string, string>) {
  for (const key of KEYS) delete process.env[key]
  Object.assign(process.env, env)
  vi.resetModules()
  return import('@/lib/brand/config')
}

describe('BRAND.operatorName (AWTD-1584)', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.resetModules()
  })

  it('is Astrid’s operator when nothing is configured', async () => {
    expect((await brandWith({})).BRAND.operatorName).toBe('Graceful Tools LLC')
  })

  it('stays Astrid’s operator when the name is set to Astrid itself', async () => {
    expect((await brandWith({ NEXT_PUBLIC_BRAND_NAME: 'Astrid' })).BRAND.operatorName).toBe('Graceful Tools LLC')
  })

  it('falls back to a partner’s own name, never to Astrid’s operator', async () => {
    expect((await brandWith({ NEXT_PUBLIC_BRAND_NAME: 'Acme' })).BRAND.operatorName).toBe('Acme')
  })

  it('uses the configured operator over either fallback', async () => {
    const { BRAND } = await brandWith({ NEXT_PUBLIC_BRAND_NAME: 'Acme', NEXT_PUBLIC_BRAND_OPERATOR_NAME: 'Acme Corp, Inc.' })
    expect(BRAND.operatorName).toBe('Acme Corp, Inc.')
  })
})

describe('an operator’s own terms and privacy pages (AWTD-1584)', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.resetModules()
  })

  it('links the built-in pages when none is configured', async () => {
    const { brandLegalHref } = await brandWith({})
    expect(brandLegalHref('terms')).toBe('/terms')
    expect(brandLegalHref('privacy')).toBe('/privacy')
  })

  it('links the operator’s pages when configured', async () => {
    const { brandLegalHref } = await brandWith({
      NEXT_PUBLIC_BRAND_TERMS_URL: 'https://acme.example/terms',
      NEXT_PUBLIC_BRAND_PRIVACY_URL: 'https://acme.example/privacy',
    })
    expect(brandLegalHref('terms')).toBe('https://acme.example/terms')
    expect(brandLegalHref('privacy')).toBe('https://acme.example/privacy')
  })

  it('redirects /terms and /privacy there rather than serving our text', async () => {
    const redirect = vi.fn(() => { throw new Error('NEXT_REDIRECT') })
    vi.doMock('next/navigation', () => ({ redirect }))
    await brandWith({
      NEXT_PUBLIC_BRAND_TERMS_URL: 'https://acme.example/terms',
      NEXT_PUBLIC_BRAND_PRIVACY_URL: 'https://acme.example/privacy',
    })
    const Terms = (await import('@/app/[locale]/terms/page')).default
    const Privacy = (await import('@/app/[locale]/privacy/page')).default
    expect(() => Terms()).toThrow('NEXT_REDIRECT')
    expect(() => Privacy()).toThrow('NEXT_REDIRECT')
    expect(redirect).toHaveBeenCalledWith('https://acme.example/terms')
    expect(redirect).toHaveBeenCalledWith('https://acme.example/privacy')
    vi.doUnmock('next/navigation')
  })
})

describe('the ChatGPT plugin manifest names the operator’s policy (AWTD-1584)', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.resetModules()
  })

  it('points legal_info_url at the operator’s page, or ours when none is set', async () => {
    await brandWith({ NEXT_PUBLIC_BRAND_PRIVACY_URL: 'https://acme.example/privacy' })
    const { GET } = await import('@/app/.well-known/ai-plugin.json/route')
    const withUrl = await (await GET()).json()
    expect(withUrl.legal_info_url).toBe('https://acme.example/privacy')

    await brandWith({})
    const { GET: plain } = await import('@/app/.well-known/ai-plugin.json/route')
    expect((await (await plain()).json()).legal_info_url).toMatch(/\/privacy$/)
  })
})
