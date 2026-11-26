/**
 * ADEV-297: a production build served on http://localhost (CI's `next start` for the e2e suite)
 * reported the origin "http://localhost:3000" while the server expected only https origins, so
 * every passkey ceremony failed with "Unexpected response origin".
 *
 * The fix is narrow: only a NEXTAUTH_URL that is plain http on a loopback host adds its own
 * origin. A real host, https, or a lookalike must not widen the list.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { BRAND } from '@/lib/brand/config'

const ORIGINAL = { ...process.env }

async function expectedOrigins(nextAuthUrl: string | undefined): Promise<string[]> {
  vi.resetModules()
  const env = process.env as Record<string, string | undefined>
  for (const key of ['NEXTAUTH_URL', 'VERCEL_URL', 'VERCEL_ENV', 'NEXT_PUBLIC_BRAND_DOMAIN']) delete env[key]
  env.NODE_ENV = 'production'
  if (nextAuthUrl) env.NEXTAUTH_URL = nextAuthUrl
  return (await import('@/lib/webauthn')).getExpectedOrigins()
}

describe('WebAuthn expected origins on a local production build (ADEV-297)', () => {
  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.resetModules()
  })

  it('accepts the http loopback origin NEXTAUTH_URL declares', async () => {
    expect(await expectedOrigins('http://localhost:3000')).toContain('http://localhost:3000')
  })

  it('does not accept plain http for a real host', async () => {
    const origins = await expectedOrigins('http://app.example.com')
    expect(origins).not.toContain('http://app.example.com')
  })

  it('adds no http origin for production URLs', async () => {
    const origins = await expectedOrigins(`https://www.${BRAND.domain}`)
    expect(origins.filter(o => o.startsWith('http:'))).toEqual([])
  })

  it('adds no http origin when NEXTAUTH_URL is unset', async () => {
    const origins = await expectedOrigins(undefined)
    expect(origins.filter(o => o.startsWith('http:'))).toEqual([])
  })
})
