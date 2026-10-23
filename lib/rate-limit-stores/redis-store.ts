import { RateLimitEntry, RateLimitStore } from './types'
import { getRedisClient, isRedisAvailable } from '../redis'
import { createLogger } from '@/lib/logger'

const log = createLogger('rate-limit-stores.redis-store')


/**
 * Redis-backed rate limit store
 *
 * Best for:
 * - Multi-instance/distributed deployments
 * - Production environments with high availability requirements
 * - When consistent rate limiting across all servers is needed
 *
 * Features:
 * - Atomic increment: the counter is a Redis integer moved by INCR, so
 *   concurrent requests each get their own count. It used to be a JSON entry
 *   read, incremented in JavaScript and written back, and two requests arriving
 *   together both wrote n+1 — a burst counted as one (AWTD-1337).
 * - The window is the key's TTL: set by the request that opens it, read back
 *   with PTTL, and repaired if a process died between INCR and PEXPIRE, so a
 *   counter can never be left to block forever.
 * - Shared state across all server instances
 */
export class RedisRateLimitStore implements RateLimitStore {
  private prefix: string

  // `v2:` because the value changed from a JSON entry to an integer; INCR on a
  // key still holding an old entry would error until it expired.
  constructor(prefix: string = 'ratelimit:v2:') {
    this.prefix = prefix
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`
  }

  async get(key: string): Promise<RateLimitEntry | null> {
    try {
      const client = await getRedisClient()
      const redisKey = this.getKey(key)
      const [value, ttlMs] = await Promise.all([client.get(redisKey), client.pTTL(redisKey)])
      if (value === null || value === undefined || ttlMs < 0) {
        return null
      }
      return { count: Number(value), resetTime: Date.now() + ttlMs }
    } catch (error) {
      log.error({ err: error }, '[RateLimitStore] Redis get error:')
      return null
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const redisKey = this.getKey(key)
    const now = Date.now()

    try {
      const client = await getRedisClient()

      const count = Number(await client.incr(redisKey))
      // The request that opened the window sets its length.
      if (count === 1) {
        await client.pExpire(redisKey, windowMs)
      }
      let ttlMs = Number(await client.pTTL(redisKey))
      if (ttlMs < 0) {
        // No expiry: the opener died between INCR and PEXPIRE. Give the window
        // its length now rather than leave a counter that never resets.
        await client.pExpire(redisKey, windowMs)
        ttlMs = windowMs
      }

      return { count, resetTime: now + ttlMs }
    } catch (error) {
      log.error({ err: error }, '[RateLimitStore] Redis increment error:')
      // Return a default entry on error (fail open to not block requests)
      return {
        count: 1,
        resetTime: now + windowMs
      }
    }
  }

  async isAvailable(): Promise<boolean> {
    return isRedisAvailable()
  }
}

// Singleton instance for global use
let globalRedisStore: RedisRateLimitStore | null = null

export function getRedisStore(): RedisRateLimitStore {
  if (!globalRedisStore) {
    globalRedisStore = new RedisRateLimitStore()
  }
  return globalRedisStore
}
