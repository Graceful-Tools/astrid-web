import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('next-intl/middleware', () => ({
  default: () => () => new Response(null, { status: 200 }),
}))
vi.mock('@/lib/i18n/routing', () => ({ routing: { locales: ['en'], defaultLocale: 'en' } }))

import { middleware } from '@/middleware'
import { LEGACY_USAGE_BEACON_PATH, resetBeaconMemoryForTests } from '@/lib/legacy-api-usage'

/**
 * Task 641a7615, re-landed for task 058d80ad — the durable half of the legacy-traffic census.
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
    // Beacons are sampled 1-in-N, with the first hit per (route, method) always
    // sent (task f9ba26b3). That memory is module-scoped so it lives as long as
    // the edge instance; without this reset the second case to touch
    // `GET /api/tasks` would be a sampled repeat and usually send nothing.
    resetBeaconMemoryForTests()
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
      // Raw signals, not a classification: platform detection moved to the
      // Node-side beacon route, because classifying in the middleware is the
      // import that put Prisma in the edge bundle and took the site down.
      ua: 'AstridApp/1.0',
      oauthBearer: false,
    })
    expect(JSON.parse(String(init.body))).not.toHaveProperty('platform')
  })

  it('forwards only the bearer-prefix boolean, never the authorization header itself', async () => {
    const { event, settle } = fetchEvent()

    middleware(
      new NextRequest('https://www.astrid.cc/api/tasks', {
        method: 'GET',
        headers: { authorization: 'Bearer astrid_secret_token_value' },
      }),
      event,
    )
    await settle()

    const [, init] = fetchSpy.mock.calls[0] as [URL, RequestInit]
    expect(JSON.parse(String(init.body))).toMatchObject({ oauthBearer: true })
    expect(String(init.body)).not.toContain('astrid_secret_token_value')
  })

  it('samples repeats, so a hot legacy route no longer doubles invocations', async () => {
    // The first hit for a (route, method) is always sent — summarizeLegacyUsage
    // marks a route safeToDelete only on ZERO hits, so a live route must never
    // be able to report none. Everything after that is 1-in-N (task f9ba26b3).
    const { event, settle } = fetchEvent()

    for (let i = 0; i < 40; i++) middleware(req('/api/tasks'), event)
    await settle()

    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(fetchSpy.mock.calls.length).toBeLessThan(40)

    // The guaranteed first hit stands for exactly one request; sampled ones
    // carry the rate, so the recorded totals stay estimates of the truth.
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1].body)).weight).toBe(1)
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
