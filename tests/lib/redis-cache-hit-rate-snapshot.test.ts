/**
 * Task 2b89739c — the Redis cache hit rate has to be readable in production
 * without turning the global log level up.
 *
 * The budget document promises >= 80% after warm-up and had never sampled it,
 * because the only evidence was `Cache lookup` / `Cache load` at `debug` while
 * production runs at `info`. Those events are deliberately at debug (PR #260)
 * — they are per-lookup and expensive — so the fix cannot be to promote them.
 *
 * Instead `RedisCache` flushes ONE structured `info` event per process per
 * window. Two properties make that event usable, and both are asserted here
 * rather than assumed:
 *
 *   - it carries the DELTA for the window, not the lifetime total. Cumulative
 *     counters logged repeatedly cannot be summed — the same hits reappear in
 *     every event — so aggregating the fleet would mean taking the last event
 *     per instance and hoping none died early. Deltas sum by construction.
 *   - it fires on elapsed time, not on lookup count, so its volume is bounded
 *     by the window no matter how hot the path gets. That is the whole reason
 *     it can live at `info` when the per-lookup events cannot.
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

/** The one event this task exists to produce. */
const snapshots = () => logged.filter(e => e.level === 'info' && e.message === 'Cache metrics window')

beforeEach(async () => {
  vi.clearAllMocks()
  logged.length = 0
  vi.useRealTimers()
  process.env.REDIS_URL = 'redis://test'
  client.setEx.mockResolvedValue('OK')
  client.sAdd.mockResolvedValue(1)
  client.expire.mockResolvedValue(1)

  const { RedisCache } = await import('@/lib/redis')
  RedisCache.resetMetrics()
})

describe('cache metrics snapshot (task 2b89739c)', () => {
  it('does not emit a snapshot per lookup', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockResolvedValue(JSON.stringify('cached'))

    for (let i = 0; i < 25; i++) await RedisCache.get(`k${i}`)

    // 25 lookups inside one window: at most the window's single flush, which
    // is the property that lets this event sit at info level at all.
    expect(snapshots().length).toBeLessThanOrEqual(1)
  })

  it('emits one info-level snapshot once the window elapses', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockResolvedValue(JSON.stringify('cached'))

    await RedisCache.get('a')
    await RedisCache.get('b')
    RedisCache.__advanceMetricsWindowForTest()
    await RedisCache.get('c')

    const flushed = snapshots()
    expect(flushed).toHaveLength(1)
    expect(flushed[0].payload).toMatchObject({ hits: expect.any(Number), misses: expect.any(Number) })
    expect(flushed[0].payload).toHaveProperty('instanceId')
    expect(flushed[0].payload).toHaveProperty('windowMs')
  })

  it('reports the window delta, so fleet totals are a sum and not a double-count', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockResolvedValue(JSON.stringify('cached'))

    await RedisCache.get('a')
    await RedisCache.get('b')
    RedisCache.__advanceMetricsWindowForTest()
    await RedisCache.get('c') // closes window 1 (the triggering lookup counts in it)
    await RedisCache.get('d')
    RedisCache.__advanceMetricsWindowForTest()
    await RedisCache.get('e') // closes window 2

    const [first, second] = snapshots()

    // The property that matters is not where the boundary falls but that
    // nothing is counted twice and nothing is dropped: every emitted delta,
    // plus whatever is still open, adds up to the lifetime total exactly once.
    // Cumulative counters would fail this — window 2 would report 5, and a
    // fleet sum would count window 1 twice.
    expect(first.payload.hits).toBe(3)
    expect(second.payload.hits).toBe(2)
    expect(Number(first.payload.hits) + Number(second.payload.hits)).toBe(5)
    expect(RedisCache.getMetrics().hits).toBe(5)
  })

  it('loses no lookup across many windows', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockResolvedValue(JSON.stringify('cached'))

    // Flush at irregular intervals, the way real traffic would.
    for (const gap of [3, 1, 7, 2, 5]) {
      for (let i = 0; i < gap; i++) await RedisCache.get('k')
      RedisCache.__advanceMetricsWindowForTest()
    }
    RedisCache.__flushMetricsWindowForTest()

    const emitted = snapshots().reduce((sum, e) => sum + Number(e.payload.hits), 0)
    expect(emitted).toBe(RedisCache.getMetrics().hits)
    expect(emitted).toBe(18)
  })

  it('carries a hit rate for the window, and misses count toward it', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockResolvedValueOnce(JSON.stringify('cached'))
    client.get.mockResolvedValueOnce(null)
    client.get.mockResolvedValueOnce(JSON.stringify('cached'))
    client.get.mockResolvedValueOnce(JSON.stringify('cached'))

    await RedisCache.get('a') // hit
    await RedisCache.get('b') // miss
    await RedisCache.get('c') // hit
    RedisCache.__advanceMetricsWindowForTest()
    await RedisCache.get('d') // hit, and closes the window

    const [flushed] = snapshots()
    expect(flushed.payload).toMatchObject({ hits: 3, misses: 1 })
    expect(flushed.payload.hitRate).toBe(75)
  })

  it('says nothing when a window had no traffic', async () => {
    const { RedisCache } = await import('@/lib/redis')
    client.get.mockResolvedValue(JSON.stringify('cached'))

    await RedisCache.get('a')
    RedisCache.__advanceMetricsWindowForTest()
    await RedisCache.get('b') // flushes the window with 1 hit
    RedisCache.__advanceMetricsWindowForTest()

    const before = snapshots().length
    // An idle instance must not emit an all-zero row every window; those are
    // noise in the log and skew nothing but the reader's patience.
    RedisCache.__flushMetricsWindowForTest()
    expect(snapshots().length).toBe(before)
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
