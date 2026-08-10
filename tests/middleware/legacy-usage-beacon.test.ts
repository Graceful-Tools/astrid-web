import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response(null, { status: 200 }),
}))
vi.mock('@/lib/i18n/routing', () => ({ routing: { locales: ['en'], defaultLocale: 'en' } }))

import { middleware } from '@/middleware'
import { LEGACY_USAGE_BEACON_PATH } from '@/lib/legacy-api-usage'

/**
 * Task 641a7615 — the durable half of the legacy-traffic census.
 *
 * The log line the middleware already emits is a live tail that Vercel keeps
 * for minutes. This pins the beacon that makes the >=4-week window real, and
 * the two ways it could go wrong: recursing on itself, or breaking traffic.
 */
function req(pathname: string, method = 'GET') {
  return new NextRequest(`https://www.astrid.cc${pathname}`, {
    method,
    headers: { 'user-agent': 'AstridApp/1.0' },
  })
}

/** A NextFetchEvent stand-in that records what was handed to waitUntil. */
function fetchEvent() {
  const pending: Promise<unknown>[] = []
  return {
    event: { waitUntil: (p: Promise<unknown>) => pending.push(p) } as never,
    settle: () => Promise.allSettled(pending),
    count: () => pending.length,
  }
}

describe('legacy usage beacon (task 641a7615)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = 'test-secret'
    fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('beacons a legacy hit to the durable census', async () => {
    const { event, settle } = fetchEvent()

    middleware(req('/api/tasks'), event)
    await settle()

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toContain(LEGACY_USAGE_BEACON_PATH)
    expect(JSON.parse(String(init.body))).toMatchObject({
      route: '/api/tasks',
      method: 'GET',
      platform: 'iOS-app',
    })
  })

  it('does NOT beacon the beacon — otherwise every hit generates a hit, forever', async () => {
    const { event, settle } = fetchEvent()

    middleware(req(LEGACY_USAGE_BEACON_PATH, 'POST'), event)
    await settle()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('does not beacon the v1 surface', async () => {
    const { event, settle } = fetchEvent()

    middleware(req('/api/v1/tasks'), event)
    await settle()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('stays silent when no internal secret is configured, rather than posting unauthenticated', async () => {
    delete process.env.INTERNAL_API_SECRET
    const { event, settle } = fetchEvent()

    middleware(req('/api/tasks'), event)
    await settle()

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still serves the request when the beacon throws — telemetry is never load-bearing', async () => {
    fetchSpy.mockRejectedValue(new Error('census down'))
    const { event, settle } = fetchEvent()

    const response = middleware(req('/api/tasks'), event)
    const settled = await settle()

    expect(response.status).toBe(200)
    expect(settled.every(r => r.status === 'fulfilled')).toBe(true)
  })

  it('still attaches the RFC 8594 deprecation headers alongside the beacon', async () => {
    const { event } = fetchEvent()

    const response = middleware(req('/api/tasks'), event)

    expect(response.headers.get('Deprecation')).toBe('true')
    expect(response.headers.get('Sunset')).toBeTruthy()
  })
})
