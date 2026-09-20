/**
 * The Core Web Vitals ingest route (AWTD-904).
 *
 * The route is unauthenticated on purpose, so what matters is that it cannot
 * be used to write anything a percentile would believe: unknown metrics,
 * absurd values and missing fields must all be refused, and the rating must
 * come from our thresholds rather than from whatever the client claimed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const recordMock = vi.fn(async (..._args: unknown[]) => true)
vi.mock('@/lib/web-vitals-service', () => ({
  recordWebVitalSample: (...args: unknown[]) => recordMock(...args),
  getWebVitalsReport: vi.fn(),
}))

const limitMock = vi.fn(async () => ({ allowed: true, remaining: 29, resetTime: 0, total: 30 }))
vi.mock('@/lib/rate-limiter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/rate-limiter')>()
  return {
    ...actual,
    webVitalsRateLimiter: { checkRateLimitAsync: () => limitMock() },
  }
})

import { POST } from '@/app/api/internal/web-vitals/route'
import { BRAND } from '@/lib/brand/config'

function beacon(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://www.${BRAND.domain}/api/internal/web-vitals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const valid = {
  metric: 'LCP',
  value: 2400,
  path: '/en/lists/1f8c4a6e-2b3d-4c5e-9a7b-0d1e2f3a4b5c',
  authState: 'anonymous',
  sessionId: 'tab-1',
}

describe('POST /api/internal/web-vitals (AWTD-904)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    limitMock.mockResolvedValue({ allowed: true, remaining: 29, resetTime: 0, total: 30 })
  })

  it('stores a valid sample with the route normalised and the locale stripped', async () => {
    const res = await POST(beacon(valid))

    expect(res.status).toBe(200)
    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ metric: 'LCP', value: 2400, route: '/lists/:id', authState: 'anonymous' }),
    )
  })

  it('classifies the platform from the request rather than trusting the body', async () => {
    await POST(beacon({ ...valid, platform: 'iOS-app' }, { 'x-platform': 'ios-app' }))

    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ platform: 'iOS-app' }))
  })

  it('refuses a metric outside the three Core Web Vitals', async () => {
    await POST(beacon({ ...valid, metric: 'TTFB' }))

    expect(recordMock).not.toHaveBeenCalled()
  })

  it('refuses a non-finite value, which would poison every future p75', async () => {
    // JSON.stringify turns Infinity into null, which the schema must also reject.
    await POST(beacon({ ...valid, value: Infinity }))

    expect(recordMock).not.toHaveBeenCalled()
  })

  it('refuses an unknown auth state rather than storing a third bucket', async () => {
    await POST(beacon({ ...valid, authState: 'admin' }))

    expect(recordMock).not.toHaveBeenCalled()
  })

  it('answers 200 for malformed input, so telemetry never looks like an incident', async () => {
    const res = await POST(beacon({ nonsense: true }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: false })
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('rate limits by IP, since the endpoint takes no credentials', async () => {
    limitMock.mockResolvedValue({ allowed: false, remaining: 0, resetTime: 0, total: 30 })

    const res = await POST(beacon(valid))

    expect(res.status).toBe(429)
    expect(recordMock).not.toHaveBeenCalled()
  })
})
