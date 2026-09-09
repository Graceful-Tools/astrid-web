/**
 * @vitest-environment node
 *
 * Regression for task a0e0808c — "difficult to set up as an MCP server".
 *
 * middleware redirects the naked domain astrid.cc -> www.astrid.cc with a 308.
 * `.well-known` and `/api` are exempt, but `/mcp` was not. Because the redirect
 * crosses hosts, HTTP clients drop the Authorization header on the way — curl
 * and most MCP clients do this by design — so:
 *
 *   POST https://astrid.cc/mcp      -> 308 -> 401 "Provide Authorization..."
 *   POST https://www.astrid.cc/mcp  -> 200
 *
 * The endpoint worked, but only at a URL the docs didn't consistently give,
 * and the failure looked like an auth problem rather than a redirect problem.
 * /mcp is an API surface like /api — it must not be canonicalised.
 */
import { describe, it, expect, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { BRAND } from '@/lib/brand/config'

// next-intl's middleware cannot load under vitest; the apex redirect runs
// before it and is what these tests cover, so stub it out (same approach as
// tests/middleware/locale-routing.test.ts).
vi.mock('next-intl/middleware', () => ({
  default: () => () => NextResponse.next(),
}))

const { middleware } = await import('@/middleware')

function request(url: string, host: string) {
  return new NextRequest(new Request(url, { headers: { host } }))
}

/** 308 to another host is what strips the Authorization header. */
function isApexRedirect(res: Response | undefined) {
  if (!res) return false
  const location = res.headers.get('location')
  return res.status === 308 && !!location && new URL(location).host === `www.${BRAND.domain}`
}

describe('apex -> www redirect exemptions (task a0e0808c)', () => {
  it('does not redirect /mcp, which would strip the Authorization header', () => {
    const res = middleware(request(`https://${BRAND.domain}/mcp`, `${BRAND.domain}`)) as Response
    expect(isApexRedirect(res)).toBe(false)
  })

  it('does not redirect the /mcp/messages SSE post path either', () => {
    const res = middleware(request(`https://${BRAND.domain}/mcp/messages`, `${BRAND.domain}`)) as Response
    expect(isApexRedirect(res)).toBe(false)
  })

  it('still exempts /api and /.well-known', () => {
    expect(isApexRedirect(middleware(request(`https://${BRAND.domain}/api/v1/lists`, `${BRAND.domain}`)) as Response)).toBe(false)
    expect(isApexRedirect(middleware(request(`https://${BRAND.domain}/.well-known/x`, `${BRAND.domain}`)) as Response)).toBe(false)
  })

  it('still canonicalises ordinary pages to www', () => {
    // The redirect exists for a reason; only API surfaces are exempt.
    const res = middleware(request(`https://${BRAND.domain}/settings`, `${BRAND.domain}`)) as Response
    expect(isApexRedirect(res)).toBe(true)
  })

  it('leaves requests already on www alone', () => {
    const res = middleware(request(`https://www.${BRAND.domain}/mcp`, `www.${BRAND.domain}`)) as Response
    expect(isApexRedirect(res)).toBe(false)
  })
})
