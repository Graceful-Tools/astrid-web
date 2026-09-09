import { describe, expect, it, vi } from 'vitest'

// The host literal sits inside a vi.mock factory, which is hoisted above the
// imports — so a plain `import { BRAND }` is still in its temporal dead zone
// when the factory runs. vi.hoisted evaluates in the hoisted block (AWTD-867).
const { BRAND } = await vi.hoisted(async () => await import('@/lib/brand/config'))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({
    host: BRAND.domain,
    'x-forwarded-proto': 'https',
  })),
}))

import { GET } from '@/app/.well-known/oauth-authorization-server/route'

describe('OAuth authorization server discovery (task a0e0808c)', () => {
  it('advertises dynamic registration and S256 PKCE for MCP hosts', async () => {
    const response = await GET()
    const metadata = await response.json()

    expect(metadata.registration_endpoint).toBe(`https://${BRAND.domain}/api/v1/oauth/register`)
    expect(metadata.token_endpoint_auth_methods_supported).toContain('none')
    expect(metadata.code_challenge_methods_supported).toEqual(['S256'])
  })
})
