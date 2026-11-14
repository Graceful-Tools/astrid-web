/**
 * @vitest-environment node
 *
 * AWTD-1565 review blocker: a persistent failure used to reconnect every ~3 s,
 * trip the 5-per-minute SSE rate limit, and then stop for good because the 429
 * was thrown from a timer callback nobody retried. Drives the real SSEClient
 * with only fetch faked and the clock under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OAuthClient } from '../../packages/astrid-sdk/src/channel/oauth-client'
import { SSEClient } from '../../packages/astrid-sdk/src/channel/sse-client'
import type { AstridChannelConfig } from '../../packages/astrid-sdk/src/channel/types'
import { frame } from '../fixtures/sdk-sse'

const config: AstridChannelConfig = {
  enabled: true, clientId: 'client-id', clientSecret: 'client-secret',
  apiBase: 'https://sdk-test.example/api/v1',
}

type Reply = () => Response
let replies: Reply[]
let connectTimes: number[]
let client: SSEClient

const connected = frame({ timestamp: new Date().toISOString() }, { event: 'connected' })
const keepalive = frame({ serverTime: new Date().toISOString() }, { event: 'keepalive' })
const stream = (...chunks: string[]): Reply => () => new Response(new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
    controller.close()
  },
}))
const rateLimited = (retryAfterSeconds = 1): Reply => () => new Response(
  JSON.stringify({ error: 'Too many SSE connections', retryAfter: retryAfterSeconds }),
  { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
)
const gaps = () => connectTimes.slice(1).map((time, index) => time - connectTimes[index])

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-11-14T12:00:00Z'))
  replies = []
  connectTimes = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(Math, 'random').mockReturnValue(0.5) // no jitter unless a test says so
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.endsWith('/oauth/token')) return Response.json({ access_token: 'test-token', expires_in: 3600 })
    connectTimes.push(Date.now())
    return (replies.shift() ?? rateLimited())()
  }))
  client = new SSEClient(config, new OAuthClient(config))
})

afterEach(() => {
  client.disconnect()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('AWTD-1565 SSE reconnect backoff', () => {
  it('AWTD-1565 backs off exponentially to a 60 s cap and keeps retrying through rate limiting', async () => {
    replies = [stream(connected)]
    await client.connect()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(gaps().slice(0, 8)).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000])
    expect(Math.max(...gaps())).toBe(60_000)
    // Twenty minutes in, it is still trying: a 429 never stops the channel.
    expect(connectTimes.length).toBeGreaterThan(20)
  })

  it('AWTD-1565 also retries when the stream fails before it opens (network error)', async () => {
    replies = [stream(connected), () => { throw new TypeError('fetch failed') }, () => { throw new TypeError('fetch failed') }]
    await client.connect()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(gaps().slice(0, 3)).toEqual([2_000, 4_000, 8_000])
  })

  it('AWTD-1565 resets the backoff after a healthy connection', async () => {
    replies = [stream(connected), rateLimited(), rateLimited(), rateLimited(), stream(connected, keepalive), rateLimited()]
    await client.connect()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(gaps().slice(0, 6)).toEqual([2_000, 4_000, 8_000, 16_000, 2_000, 4_000])
  })

  it('AWTD-1565 a connection that opens and closes without a keepalive does not reset the backoff', async () => {
    replies = [stream(connected), stream(connected), stream(connected), stream(connected)]
    await client.connect()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(gaps().slice(0, 3)).toEqual([2_000, 4_000, 8_000])
  })

  it('AWTD-1565 waits at least the server Retry-After', async () => {
    replies = [stream(connected), rateLimited(45)]
    await client.connect()
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(gaps().slice(0, 2)).toEqual([2_000, 45_000])
  })

  it('AWTD-1565 jitters within ±20% and never exceeds the cap', async () => {
    vi.mocked(Math.random).mockReturnValue(0)
    replies = [stream(connected)]
    await client.connect()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(gaps().slice(0, 2)).toEqual([1_600, 3_200])
    vi.mocked(Math.random).mockReturnValue(0.999)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(Math.max(...gaps())).toBeLessThanOrEqual(60_000)
  })

  it('AWTD-1565 disconnect cancels a pending reconnect', async () => {
    replies = [stream(connected)]
    await client.connect()
    client.disconnect()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(connectTimes).toHaveLength(1)
  })
})
