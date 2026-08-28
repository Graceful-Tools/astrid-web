/**
 * The beacon route's platform classification (task 058d80ad).
 *
 * This is the one piece that differs from the reverted original: the
 * middleware used to classify the platform itself, which required the import
 * that put Prisma in the edge bundle and took the site down. Now the beacon
 * carries raw signals and THIS route — Node runtime, where analytics-events
 * is safe — classifies with the one shared detectPlatform.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const recordMock = vi.fn(async () => {})
vi.mock('@/lib/legacy-api-usage-service', () => ({
  recordLegacyApiHit: (...args: unknown[]) => recordMock(...args),
  getLegacyUsageReport: vi.fn(),
}))
vi.mock('@/lib/admin-auth', () => ({ isAdmin: vi.fn(async () => false) }))
vi.mock('@/lib/session-utils', () => ({ getUnifiedSession: vi.fn(async () => null) }))

import { POST } from '@/app/api/internal/legacy-api-usage/route'

function beacon(body: Record<string, unknown>, secret = 'test-secret') {
  return new NextRequest('https://www.astrid.cc/api/internal/legacy-api-usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret },
    body: JSON.stringify(body),
  })
}

describe('POST /api/internal/legacy-api-usage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INTERNAL_API_SECRET = 'test-secret'
  })

  it('classifies the iOS app from the forwarded x-platform header', async () => {
    await POST(beacon({ route: '/api/tasks', method: 'GET', ua: '', xPlatform: 'ios-app' }))

    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ route: '/api/tasks', platform: 'iOS-app' })
    )
  })

  it('classifies programmatic OAuth traffic from the forwarded prefix boolean', async () => {
    await POST(beacon({ route: '/api/tasks', method: 'GET', ua: 'curl/8.0', oauthBearer: true }))

    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'API-other' })
    )
  })

  it('classifies desktop web from the forwarded user-agent', async () => {
    await POST(
      beacon({ route: '/api/lists', method: 'GET', ua: 'Mozilla/5.0 (Macintosh) Safari/605' })
    )

    expect(recordMock).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'web-desktop' })
    )
  })

  it('rejects a beacon without the internal secret, and records nothing', async () => {
    const response = await POST(beacon({ route: '/api/tasks', method: 'GET', ua: '' }, 'wrong'))

    expect(response.status).toBe(401)
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('answers 200 to a malformed beacon — telemetry is never load-bearing', async () => {
    const response = await POST(beacon({ nonsense: true }))

    expect(response.status).toBe(200)
    expect(recordMock).not.toHaveBeenCalled()
  })
})
