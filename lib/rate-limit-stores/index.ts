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
    log.warn(
      '[RateLimitStore] Redis is NOT available — falling back to the per-instance memory store. ' +
      'Rate limits are now per warm instance and reset on cold start; auth limits are effectively ' +
      'multiplied by the instance count until Redis returns.'
    )
  } catch (error) {
    log.warn({ error }, '[RateLimitStore] Redis check FAILED, degrading to the per-instance memory store:')
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
    const previous = cachedStore
    cachedStore = await getRateLimitStore()
    lastCheck = now

    // A Redis blip used to downgrade the whole process to the in-memory store
    // for the next 60 seconds with nothing in the logs saying so (task
    // c2fbe8e4). Every transition is now reported at warn, so the window is
    // attributable after the fact.
    if (previous && previous !== cachedStore) {
      log.warn(
        { from: previous.constructor.name, to: cachedStore.constructor.name },
        '[RateLimitStore] Rate limit store CHANGED'
      )
    } else if (!previous) {
      log.info(`[RateLimitStore] Using ${cachedStore.constructor.name}`)
    }
  }

  return cachedStore
}
