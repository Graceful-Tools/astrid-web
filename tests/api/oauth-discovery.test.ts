import { describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({
    host: 'astrid.cc',
    'x-forwarded-proto': 'https',
  })),
}))

import { GET } from '@/app/.well-known/oauth-authorization-server/route'

describe('OAuth authorization server discovery (task a0e0808c)', () => {
  it('advertises dynamic registration and S256 PKCE for MCP hosts', async () => {
    const response = await GET()
    const metadata = await response.json()

    expect(metadata.registration_endpoint).toBe('https://astrid.cc/api/v1/oauth/register')
    expect(metadata.token_endpoint_auth_methods_supported).toContain('none')
    expect(metadata.code_challenge_methods_supported).toEqual(['S256'])
  })
})
