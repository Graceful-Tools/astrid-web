/**
 * @vitest-environment node
 *
 * The apex→www redirect is per brand (2026-10-04). The partner test site's brand domain is
 * tasks.gracefultools.com — itself a subdomain — and every page redirected to
 * www.tasks.gracefultools.com, which has no DNS, so the site never opened.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('next-intl/middleware', () => ({
  default: () => () => NextResponse.next(),
}))

const ORIGINAL = { ...process.env }
afterEach(() => {
  process.env = { ...ORIGINAL }
  vi.resetModules()
})

async function pageResponse(domain: string, wwwRedirect: string | undefined) {
  vi.resetModules()
  process.env.NEXT_PUBLIC_BRAND_DOMAIN = domain
  if (wwwRedirect === undefined) delete process.env.NEXT_PUBLIC_BRAND_WWW_REDIRECT
  else process.env.NEXT_PUBLIC_BRAND_WWW_REDIRECT = wwwRedirect
  const { middleware } = await import('@/middleware')
  const req = new NextRequest(new Request(`https://${domain}/settings`, { headers: { host: domain } }))
  return middleware(req) as Response
}

describe('apex→www redirect is a brand setting', () => {
  it('serves a subdomain brand as-is when the redirect is off', async () => {
    const res = await pageResponse('tasks.gracefultools.com', 'false')
    const location = res?.headers.get('location')
    expect(location ? new URL(location).host : null).not.toBe('www.tasks.gracefultools.com')
  })

  it('still redirects an apex brand by default (Astrid unchanged)', async () => {
    // A neutral apex — tests must not hardcode the brand domain (task f5022e72).
    const res = await pageResponse('example.com', undefined)
    expect(res.status).toBe(308)
    expect(new URL(res.headers.get('location')!).host).toBe('www.example.com')
  })
})
