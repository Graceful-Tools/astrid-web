/**
 * The client render-error beacon (AWTD-1076).
 *
 * Tapping a task row on a phone showed "Something went wrong" and nothing
 * anywhere recorded why: the error boundary only logged in development, and the
 * crash made no failing request. This route is how a production render error
 * reaches the logs, so what matters is that the exception arrives intact enough
 * to diagnose — message, stack, digest, route, browser — and nothing that
 * identifies anyone does.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { errorLog } = vi.hoisted(() => ({ errorLog: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ error: errorLog, warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

const limitMock = vi.fn(async () => ({ allowed: true, remaining: 9, resetTime: 0, total: 10 }))
vi.mock('@/lib/rate-limiter', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/rate-limiter')>()
  return {
    ...actual,
    clientErrorsRateLimiter: { checkRateLimitAsync: () => limitMock() },
  }
})

import { POST } from '@/app/api/internal/client-errors/route'
import { BRAND } from '@/lib/brand/config'

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'

function beacon(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`https://www.${BRAND.domain}/api/internal/client-errors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'user-agent': IPHONE_SAFARI, ...headers },
    body: JSON.stringify(body),
  })
}

const valid = {
  boundary: 'route',
  message: "undefined is not an object (evaluating 'e.lists[0].id')",
  // Safari's frame format, which redaction must leave readable.
  stack: `TaskDetail@https://www.${BRAND.domain}/_next/static/chunks/123.js:1:2345`,
  digest: '1234567890',
  path: '/en/lists/1f8c4a6e-2b3d-4c5e-9a7b-0d1e2f3a4b5c',
}

describe('POST /api/internal/client-errors (AWTD-1076)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    limitMock.mockResolvedValue({ allowed: true, remaining: 9, resetTime: 0, total: 10 })
  })

  it('logs the exception at error level with the route normalised and the browser named', async () => {
    const res = await POST(beacon(valid))

    expect(res.status).toBe(200)
    expect(errorLog).toHaveBeenCalledTimes(1)
    const [fields, msg] = errorLog.mock.calls[0]
    expect(msg).toMatch(/client render error/i)
    expect(fields).toMatchObject({
      boundary: 'route',
      message: valid.message,
      stack: valid.stack,
      digest: valid.digest,
      route: '/lists/:id',
    })
    expect(fields.userAgent).toContain('iPhone')
  })

  it('redacts ids and email addresses from the message and stack', async () => {
    await POST(beacon({
      ...valid,
      message: 'No task 93b58e1d-97c3-493c-85a2-5634ae656c3f for jon@example.com',
      stack: 'at /tasks/93b58e1d-97c3-493c-85a2-5634ae656c3f',
    }))

    const [fields] = errorLog.mock.calls[0]
    const logged = JSON.stringify(fields)
    expect(logged).not.toContain('93b58e1d-97c3-493c-85a2-5634ae656c3f')
    expect(logged).not.toContain('jon@example.com')
  })

  it('refuses an unknown boundary rather than logging free-form input', async () => {
    await POST(beacon({ ...valid, boundary: 'anything' }))

    expect(errorLog).not.toHaveBeenCalled()
  })

  it('answers 200 for malformed input, so a bad beacon never reads as an incident', async () => {
    const res = await POST(beacon({ nonsense: true }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: false })
    expect(errorLog).not.toHaveBeenCalled()
  })

  it('rate limits by IP, since the endpoint takes no credentials', async () => {
    limitMock.mockResolvedValue({ allowed: false, remaining: 0, resetTime: 0, total: 10 })

    const res = await POST(beacon(valid))

    expect(res.status).toBe(429)
    expect(errorLog).not.toHaveBeenCalled()
  })
})
