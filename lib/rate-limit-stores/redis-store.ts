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
 * - Atomic increment operations
 * - Automatic expiry via Redis TTL
 * - Shared state across all server instances
 */
export class RedisRateLimitStore implements RateLimitStore {
  private prefix: string

  constructor(prefix: string = 'ratelimit:') {
    this.prefix = prefix
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`
  }

  async get(key: string): Promise<RateLimitEntry | null> {
    try {
      const client = await getRedisClient()
      const redisKey = this.getKey(key)
      const data = await client.get(redisKey)

      if (!data) {
        return null
      }

      const entry = JSON.parse(data) as RateLimitEntry

      // Check if entry has expired (shouldn't happen with Redis TTL, but be safe)
      if (Date.now() > entry.resetTime) {
        return null
      }

      return entry
    } catch (error) {
      log.error({ err: error }, '[RateLimitStore] Redis get error:')
      return null
    }
  }

  async increment(key: string, windowMs: number): Promise<RateLimitEntry> {
    const redisKey = this.getKey(key)
    const now = Date.now()
    const ttlSeconds = Math.ceil(windowMs / 1000)

    try {
      const client = await getRedisClient()

      // Get current entry
      const data = await client.get(redisKey)
      let entry: RateLimitEntry

      if (!data) {
        // New entry
        entry = {
          count: 1,
          resetTime: now + windowMs
        }
      } else {
        const existing = JSON.parse(data) as RateLimitEntry

        // Check if window has expired
        if (now > existing.resetTime) {
          // Start a new window
          entry = {
            count: 1,
            resetTime: now + windowMs
          }
        } else {
          // Increment existing entry
          entry = {
            count: existing.count + 1,
            resetTime: existing.resetTime
          }
        }
      }

      // Save with TTL
      // Calculate remaining TTL based on resetTime
      const remainingTtl = Math.ceil((entry.resetTime - now) / 1000)
      await client.setEx(redisKey, Math.max(remainingTtl, 1), JSON.stringify(entry))

      return entry
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
