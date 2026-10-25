/**
 * RedisRateLimitStore (AWTD-1337). `increment` read the entry, added one in
 * JavaScript and wrote it back — so two requests arriving together both read
 * n and both wrote n+1, and a burst counted as one. The file header promised
 * "atomic increment operations". These run against a fake Redis whose every
 * command yields to the event loop, which is what lets two calls interleave.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

type Stored = { value: string; expiresAt: number | null }

function fakeRedis(clock: () => number) {
  const data = new Map<string, Stored>()
  const tick = () => new Promise(resolve => setTimeout(resolve, 0))
  const live = (key: string) => {
    const entry = data.get(key)
    if (entry && entry.expiresAt !== null && entry.expiresAt <= clock()) data.delete(key)
    return data.get(key)
  }
  return {
    data,
    async get(key: string) { await tick(); return live(key)?.value ?? null },
    async setEx(key: string, seconds: number, value: string) {
      await tick(); data.set(key, { value, expiresAt: clock() + seconds * 1000 }); return 'OK'
    },
    async incr(key: string) {
      await tick()
      const entry = live(key)
      const next = (entry ? Number(entry.value) : 0) + 1
      data.set(key, { value: String(next), expiresAt: entry?.expiresAt ?? null })
      return next
    },
    async pExpire(key: string, ms: number) {
      await tick(); const entry = live(key); if (!entry) return 0
      entry.expiresAt = clock() + ms; return 1
    },
    async pTTL(key: string) {
      await tick(); const entry = live(key)
      if (!entry) return -2
      return entry.expiresAt === null ? -1 : entry.expiresAt - clock()
    },
  }
}

let now = 1_000_000
let client: ReturnType<typeof fakeRedis>

vi.mock('@/lib/redis', () => ({
  getRedisClient: async () => client,
  isRedisAvailable: async () => true,
}))

import { RedisRateLimitStore } from '@/lib/rate-limit-stores/redis-store'

beforeEach(() => {
  now = 1_000_000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  client = fakeRedis(() => now)
})

describe('RedisRateLimitStore.increment (AWTD-1337)', () => {
  it('counts concurrent requests — a burst is not one request', async () => {
    const store = new RedisRateLimitStore()
    const results = await Promise.all(Array.from({ length: 5 }, () => store.increment('ip:1', 60_000)))
    expect(results.map(r => r.count).sort()).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps one window: resetTime is when the first request\'s window ends', async () => {
    const store = new RedisRateLimitStore()
    const first = await store.increment('ip:1', 60_000)
    now += 10_000
    const second = await store.increment('ip:1', 60_000)
    expect(first.resetTime).toBe(1_000_000 + 60_000)
    expect(second).toEqual({ count: 2, resetTime: 1_000_000 + 60_000 })
  })

  it('starts a fresh window once the last one has expired', async () => {
    const store = new RedisRateLimitStore()
    await store.increment('ip:1', 60_000)
    await store.increment('ip:1', 60_000)
    now += 60_001
    expect(await store.increment('ip:1', 60_000)).toEqual({ count: 1, resetTime: now + 60_000 })
  })

  it('repairs a counter left without an expiry, so it cannot block forever', async () => {
    const store = new RedisRateLimitStore()
    await store.increment('ip:1', 60_000)
    // A process that died between INCR and PEXPIRE leaves exactly this.
    for (const entry of client.data.values()) entry.expiresAt = null
    const next = await store.increment('ip:1', 60_000)
    expect(next.resetTime).toBe(now + 60_000)
    now += 60_001
    expect((await store.increment('ip:1', 60_000)).count).toBe(1)
  })

  it('get reads the current window without counting', async () => {
    const store = new RedisRateLimitStore()
    expect(await store.get('ip:1')).toBeNull()
    await store.increment('ip:1', 60_000)
    await store.increment('ip:1', 60_000)
    expect(await store.get('ip:1')).toEqual({ count: 2, resetTime: 1_000_000 + 60_000 })
  })

  it('fails open on a Redis error', async () => {
    client.incr = async () => { throw new Error('down') }
    client.get = async () => { throw new Error('down') }
    const store = new RedisRateLimitStore()
    expect(await store.increment('ip:1', 60_000)).toEqual({ count: 1, resetTime: now + 60_000 })
  })
})
