export type { RateLimitStore, RateLimitEntry } from './types'
export { MemoryRateLimitStore, getMemoryStore } from './memory-store'
export { RedisRateLimitStore, getRedisStore } from './redis-store'

import { RateLimitStore } from './types'
import { getMemoryStore } from './memory-store'
import { getRedisStore } from './redis-store'
import { isRedisAvailable } from '../redis'
import { createLogger } from '@/lib/logger'

const log = createLogger('rate-limit-stores.index')


/**
 * Get the appropriate rate limit store based on Redis availability
 *
 * Priority:
 * 1. Redis (if available) - for distributed deployments
 * 2. Memory - fallback for single-instance or when Redis unavailable
 */
export async function getRateLimitStore(): Promise<RateLimitStore> {
  try {
    const redisAvailable = await isRedisAvailable()
    if (redisAvailable) {
      return getRedisStore()
    }
  } catch (error) {
    log.warn({ error }, '[RateLimitStore] Redis check failed, using memory store:')
  }

  return getMemoryStore()
}

// Cache the store selection to avoid repeated checks
let cachedStore: RateLimitStore | null = null
let lastCheck = 0
const CHECK_INTERVAL = 60000 // Re-check Redis availability every minute

/**
 * Get the cached rate limit store, re-checking Redis availability periodically
 */
export async function getCachedRateLimitStore(): Promise<RateLimitStore> {
  const now = Date.now()

  if (!cachedStore || now - lastCheck > CHECK_INTERVAL) {
    cachedStore = await getRateLimitStore()
    lastCheck = now

    // Log which store is being used (only on initial selection or change)
    if (cachedStore.isAvailable) {
      const isRedis = await cachedStore.isAvailable()
      const storeType = isRedis ? 'Redis' : 'Memory'
      log.info(`[RateLimitStore] Using ${storeType} store`)
    }
  }

  return cachedStore
}
