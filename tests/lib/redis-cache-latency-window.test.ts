/**
 * The cache window carries latency, and lands in the database (AWTD-905).
 *
 * The window event has existed since 2026-09-12 and was unreadable in
 * production: `vercel logs` returns exactly 100 rows however wide `--since` is,
 * so the 20-window floor the aggregation script needs was unreachable at any
 * `--hours`. Jon's answer was to put it on the analytics page instead, which
 * means the app's own Postgres — no row cap, and the page already reads it.
 *
 * So the flush now does two things, and these tests hold both to the same
 * standard the log event was held to:
 *
 *   - it still emits the `info` event, and the per-lookup events stay at
 *     `debug` (PR #260's logging-cost fix is not up for renegotiation);
 *   - it writes the window's DELTAS to a bucket, and it cannot hurt the request
 *     it is riding on. A telemetry write that can fail a cache lookup is worse
 *     than no telemetry.
 *
 * Latency is new here — nothing in `lib/redis.ts` timed anything before. Two
 * spans are measured because the interesting comparison is between them: what a
 * hit costs (a Redis round trip) versus what a miss costs (the loader).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@/lib/redis')

const client = {
  isReady: true,
  on: vi.fn(),
  connect: vi.fn(),
  get: vi.fn(),
  setEx: vi.fn(),
  sAdd: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
}

vi.mock('redis', () => ({ createClient: vi.fn(() => client) }))
vi.mock('@upstash/redis', () => ({ Redis: vi.fn() }))

const recordCacheMetricWindow = vi.fn()
vi.mock('@/lib/cache-metrics-service', () => ({
  recordCacheMetricWindow: (...args: unknown[]) => recordCacheMetricWindow(...args),
}))

const logged: Array<{ level: string; payload: Record<string, unknown>; message: string }> = []

vi.mock('@/lib/logger', () => {
  const record = (level: string) => (payload: unknown, message?: string) => {
    logged.push({
      level,
      payload: (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>,
      message: message ?? (typeof payload === 'string' ? payload : ''),
    })
  }
  return {
    createLogger: () => ({
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    }),
  }
})

const snapshots = () => logged.filter(e => e.level === 'info' && e.message === 'Cache metrics window')
const persisted = () => recordCacheMetricWindow.mock.calls.map(call => call[0] as Record<string, number>)

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Let the fire-and-forget persistence settle before asserting on it.
 *
 * The flush deliberately does not await the write — that is the property the
 * rejection tests below rely on — so a test that wants to see the write has to
 * yield to it. One timer tick is not always enough: the dynamic import adds its
 * own microtask hop per call site.
 */
const drain = () => new Promise(resolve => setTimeout(resolve, 5))

beforeEach(async () => {
  vi.clearAllMocks()
  logged.length = 0
  process.env.REDIS_URL = 'redis://test'
  client.setEx.mockResolvedValue('OK')
  client.sAdd.mockResolvedValue(1)
  client.expire.mockResolvedValue(1)
  recordCacheMetricWindow.mockResolvedValue(true)

  const { RedisCache } = await import('@/lib/redis')
  RedisCache.resetMetrics()
})

describe('cache window latency (AWTD-905)', () => {
  it('measures the Redis round trip of a lookup', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockImplementation(async () => {
      await sleep(20)
      return JSON.stringify('cached')
    })

    await RedisCache.get('a')
    RedisCache.__flushMetricsWindowForTest()

    const [flushed] = snapshots()
    expect(flushed.payload.hits).toBe(1)
    // A sum over the window's lookups, not a mean — see the module comment for
    // why a mean per window could not be aggregated afterwards.
    expect(Number(flushed.payload.lookupMs)).toBeGreaterThanOrEqual(15)
  })

  it('times a miss as a lookup too, so the mean is over every lookup', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockImplementation(async () => {
      await sleep(20)
      return null
    })

    await RedisCache.get('a')
    RedisCache.__flushMetricsWindowForTest()

    const [flushed] = snapshots()
    expect(flushed.payload).toMatchObject({ hits: 0, misses: 1 })
    expect(Number(flushed.payload.lookupMs)).toBeGreaterThanOrEqual(15)
  })

  it('measures the loader separately from the lookup', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockResolvedValue(null)

    await RedisCache.getOrSet('k', async () => {
      await sleep(30)
      return 'v'
    })
    RedisCache.__flushMetricsWindowForTest()

    const [flushed] = snapshots()
    expect(flushed.payload.loads).toBe(1)
    expect(Number(flushed.payload.loadMs)).toBeGreaterThanOrEqual(25)
    // The two spans are not the same number: this is the comparison that makes
    // the case for the cache at all.
    expect(Number(flushed.payload.loadMs)).toBeGreaterThan(Number(flushed.payload.lookupMs))
  })

  it('resets latency with the rest of the window, so two windows do not double-count it', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockImplementation(async () => {
      await sleep(20)
      return JSON.stringify('cached')
    })

    await RedisCache.get('a')
    RedisCache.__flushMetricsWindowForTest()
    await RedisCache.get('b')
    RedisCache.__flushMetricsWindowForTest()

    const [first, second] = snapshots()
    expect(Number(first.payload.lookupMs)).toBeGreaterThanOrEqual(15)
    expect(Number(second.payload.lookupMs)).toBeGreaterThanOrEqual(15)
    // Cumulative latency would make the second window report both lookups.
    expect(Number(second.payload.lookupMs)).toBeLessThan(Number(first.payload.lookupMs) * 2)
  })
})

describe('cache window persistence (AWTD-905)', () => {
  it('writes the window to a bucket as well as logging it', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockResolvedValueOnce(JSON.stringify('cached'))
    client.get.mockResolvedValueOnce(null)

    await RedisCache.get('a')
    await RedisCache.get('b')
    RedisCache.__flushMetricsWindowForTest()
    await drain()

    expect(persisted()).toHaveLength(1)
    expect(persisted()[0]).toMatchObject({ hits: 1, misses: 1 })
    expect(persisted()[0].instanceId).toEqual(snapshots()[0].payload.instanceId)
    expect(typeof persisted()[0].lookupMs).toBe('number')
  })

  it('persists the delta once per window, not the lifetime total', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockResolvedValue(JSON.stringify('cached'))

    await RedisCache.get('a')
    await RedisCache.get('b')
    RedisCache.__flushMetricsWindowForTest()
    // Drained BETWEEN the flushes, not only after both. Two of vitest's mocked
    // dynamic imports issued in one tick deliver only the first continuation;
    // Node itself delivers all of them (`void import(...)` three times in one
    // tick runs three callbacks), and real windows are a minute apart, so this
    // is the harness and not the flush.
    await drain()
    await RedisCache.get('c')
    RedisCache.__flushMetricsWindowForTest()
    await drain()

    // 2 then 1 — summing the rows gives 3. Lifetime totals would give 2 then 3,
    // and a SUM over the table would report 5 lookups for 3.
    expect(persisted().map(p => p.hits)).toEqual([2, 1])
  })

  it('writes nothing for an idle window', async () => {
    const { RedisCache } = await import('@/lib/redis')

    RedisCache.__flushMetricsWindowForTest()
    await drain()

    expect(recordCacheMetricWindow).not.toHaveBeenCalled()
  })

  it('still serves the lookup when the bucket write rejects', async () => {
    const { RedisCache } = await import('@/lib/redis')
    recordCacheMetricWindow.mockRejectedValue(new Error('connection terminated'))
    client.get.mockResolvedValue(JSON.stringify('cached'))

    await RedisCache.get('a')
    RedisCache.__advanceMetricsWindowForTest()

    // The flush rides on this lookup. If persistence could reject into it, a
    // database hiccup would read as a cache failure.
    await expect(RedisCache.get('b')).resolves.toBe('cached')
    await drain()
  })

  it('still logs the window when the bucket write rejects', async () => {
    const { RedisCache } = await import('@/lib/redis')
    recordCacheMetricWindow.mockRejectedValue(new Error('connection terminated'))
    client.get.mockResolvedValue(JSON.stringify('cached'))

    await RedisCache.get('a')
    RedisCache.__flushMetricsWindowForTest()
    await drain()

    // The log was the only source before this task; losing it whenever the new
    // one fails would be a straight regression.
    expect(snapshots()).toHaveLength(1)
  })

  it('leaves the per-lookup events at debug (PR #260 stays fixed)', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockResolvedValue(null)

    await RedisCache.getOrSet('k', async () => 'v')

    const lookupEvents = logged.filter(e => e.message === 'Cache lookup' || e.message === 'Cache load')
    expect(lookupEvents.length).toBeGreaterThan(0)
    expect(lookupEvents.every(e => e.level === 'debug')).toBe(true)
  })
})
