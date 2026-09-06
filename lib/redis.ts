import { createClient } from 'redis'
import { Redis as UpstashRedis } from '@upstash/redis'
import { createLogger } from '@/lib/logger'

const log = createLogger('redis')


// Redis client singleton (supports both standard Redis and Upstash)
let redis: ReturnType<typeof createClient> | null = null
let upstashRedis: UpstashRedis | null = null
let isUsingUpstash = false

// Circuit breaker: avoid retrying Redis connections that are known to be down
let redisUnavailableUntil = 0
const REDIS_BACKOFF_MS = 30_000 // Wait 30s before retrying after failure

// Initialize Redis client
export async function getRedisClient() {
  // Return existing Upstash client if available
  if (upstashRedis) {
    return createUpstashAdapter(upstashRedis)
  }

  // Return existing standard Redis client if available
  if (redis) {
    return redis
  }

  // Circuit breaker: don't retry if we recently failed
  if (Date.now() < redisUnavailableUntil) {
    throw new Error('Redis unavailable (circuit breaker)')
  }

  try {
    // Create Redis client - support both Upstash REST and local Redis
    const isProduction = process.env.NODE_ENV === 'production'
    const hasUpstashConfig = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN

    if (isProduction && hasUpstashConfig) {
      // Production: Use Upstash REST API (serverless-friendly)
      log.info('[Redis] Using Upstash REST API for production')
      upstashRedis = new UpstashRedis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!
      })
      isUsingUpstash = true

      // Return adapter that matches standard Redis client interface
      return createUpstashAdapter(upstashRedis)
    } else if (process.env.REDIS_URL) {
      // Development: Use local Redis server
      log.info('[Redis] Using local Redis server')
      redis = createClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: false, // Don't auto-reconnect; use circuit breaker instead
          connectTimeout: 3_000,
        }
      })
    } else {
      // No Redis configured - skip connection
      log.info('[Redis] No REDIS_URL configured, skipping Redis')
      return null
    }

    // Only set up event handlers for standard Redis client
    if (redis) {
      redis.on('error', (err) => {
        // Only log once, not on every reconnect attempt
        if (Date.now() >= redisUnavailableUntil) {
          log.error(err.message || err, '[Redis] Client error:')
        }
        redis = null
        redisUnavailableUntil = Date.now() + REDIS_BACKOFF_MS
      })

      redis.on('connect', () => {
        log.info('[Redis] Client connected')
        redisUnavailableUntil = 0 // Reset circuit breaker on success
      })

      redis.on('ready', () => {
        log.info('[Redis] Client ready')
      })

      redis.on('end', () => {
        log.info('[Redis] Client disconnected')
        redis = null
      })

      // Connect to Redis
      await redis.connect()
      return redis
    }

    throw new Error('No Redis client initialized')
  } catch (error) {
    redis = null
    upstashRedis = null
    redisUnavailableUntil = Date.now() + REDIS_BACKOFF_MS
    const msg = error instanceof Error ? error.message : String(error)
    // Suppress noisy ECONNREFUSED in dev — Redis is optional
    if (msg.includes('circuit breaker')) {
      throw error
    }
    log.warn(`[Redis] Unavailable (will retry in ${REDIS_BACKOFF_MS / 1000}s): ${msg}`)
    throw error
  }
}

// Create adapter to make Upstash client compatible with standard Redis interface
function createUpstashAdapter(upstash: UpstashRedis): any {
  return {
    isReady: true, // Upstash is always ready (HTTP-based)

    async get(key: string) {
      // Upstash returns parsed data (object/string), but standard Redis returns string
      // Convert to string to match standard Redis interface
      const result = await upstash.get(key)
      if (result === null || result === undefined) {
        return null
      }
      // If it's already a string, return it; otherwise JSON.stringify it
      return typeof result === 'string' ? result : JSON.stringify(result)
    },

    async setEx(key: string, seconds: number, value: string) {
      return await upstash.setex(key, seconds, value)
    },

    async del(key: string | string[]) {
      if (Array.isArray(key)) {
        return await upstash.del(...key)
      }
      return await upstash.del(key)
    },

    async keys(pattern: string) {
      // Upstash REST doesn't support KEYS command efficiently
      // Use SCAN command for pattern matching
      try {
        const allKeys: string[] = []
        let cursor: string | number = 0

        // SCAN with pattern matching
        do {
          const result: [string | number, string[]] = await upstash.scan(cursor, { match: pattern, count: 100 })
          cursor = typeof result[0] === 'string' ? parseInt(result[0], 10) : result[0]
          const keys = result[1]

          if (keys && keys.length > 0) {
            allKeys.push(...keys)
          }
        } while (cursor !== 0)

        return allKeys
      } catch (error) {
        log.error({ err: error }, '⚠️ [Redis] Upstash SCAN error:')
        return []
      }
    },

    async sAdd(key: string, ...members: string[]) {
      if (members.length === 0) return 0
      return await upstash.sadd(key, members[0], ...members.slice(1))
    },

    async sMembers(key: string) {
      const result = await upstash.smembers(key)
      return result || []
    },

    async expire(key: string, seconds: number) {
      return await upstash.expire(key, seconds)
    },

    async quit() {
      // Upstash is HTTP-based, no persistent connection to close
      upstashRedis = null
      isUsingUpstash = false
    }
  }
}

// Close Redis connection
export async function closeRedis() {
  if (redis) {
    await redis.quit()
    redis = null
  }
}

// Cache utility functions
/**
 * The keyset a cache key belongs to, and the keyset a delete pattern targets.
 *
 * These two MUST agree, and for a long time they did not (task 21dc1119). Keys
 * were tracked under the family prefix alone — `keyset:tasks:user:` — while
 * delPattern computed `keyset:` + the pattern minus its star, i.e.
 * `keyset:tasks:user:<id>`. They never matched, sMembers always came back
 * empty, and EVERY pattern delete fell through to a full Upstash keyspace scan
 * on the hottest write path in the app.
 *
 * Both now derive from `family:scope:id`, which is also the scope a delete
 * actually targets.
 */
const KEYSET_SCOPED_FAMILIES = [
  'tasks:user:',
  'tasks:list:',
  'lists:user:',
  'members:list:',
  'comments:task:',
] as const

export function keysetNameForKey(key: string): string | null {
  for (const family of KEYSET_SCOPED_FAMILIES) {
    if (key.startsWith(family)) {
      const id = key.slice(family.length).split(':')[0]
      return `keyset:${family}${id}`
    }
  }

  if (key.startsWith('public_lists:')) return 'keyset:public_lists:'

  return null
}

export function keysetNameForPattern(pattern: string): string {
  return `keyset:${pattern.replace('*', '')}`
}

export class RedisCache {
  private static defaultTTL = 300 // 5 minutes default TTL

  // In-flight fetches for getOrSet, keyed by cache key. Lets concurrent misses
  // for the same key share a single fetchFn() call instead of each stampeding
  // the database (thundering herd, e.g. many tabs reloading after an
  // invalidation). Entries are removed as soon as the fetch settles.
  private static inFlight = new Map<string, Promise<unknown>>()

  // Cache metrics
  private static metrics = {
    hits: 0,
    misses: 0,
    errors: 0,
    sets: 0,
    deletes: 0,
    patternDeletes: 0,
    loads: 0,
    coalesced: 0,
    loadErrors: 0,
  }

  // Get cache metrics
  static getMetrics() {
    const total = this.metrics.hits + this.metrics.misses
    return {
      ...this.metrics,
      hitRate: total > 0 ? ((this.metrics.hits / total) * 100).toFixed(2) + '%' : '0%',
      total
    }
  }

  // Reset metrics (useful for testing)
  static resetMetrics() {
    this.metrics = {
      hits: 0,
      misses: 0,
      errors: 0,
      sets: 0,
      deletes: 0,
      patternDeletes: 0,
      loads: 0,
      coalesced: 0,
      loadErrors: 0,
    }
  }

  // Get cached data
  static async get<T>(key: string): Promise<T | null> {
    try {
      const client = await getRedisClient()
      const cached = await client.get(key)

      if (cached) {
        this.metrics.hits++
        return JSON.parse(cached)
      } else {
        this.metrics.misses++
        return null
      }
    } catch (error) {
      log.error({ err: error }, 'Redis get error:')
      this.metrics.errors++
      return null // Fail silently, fall back to database
    }
  }

  // Set cached data with TTL and key set tracking
  static async set(key: string, value: any, ttl: number = this.defaultTTL): Promise<void> {
    try {
      const client = await getRedisClient()
      await client.setEx(key, ttl, JSON.stringify(value))
      this.metrics.sets++

      // Track key in appropriate pattern sets for efficient pattern deletion
      await this.trackKeyInSets(key, ttl, client)
    } catch (error) {
      log.error({ err: error }, 'Redis set error:')
      this.metrics.errors++
      // Don't throw - caching is optional
    }
  }

  // Track key in pattern sets for efficient deletion
  private static async trackKeyInSets(key: string, ttl: number, client: any): Promise<void> {
    try {
      const keysetName = keysetNameForKey(key)
      const patterns: string[] = keysetName ? [keysetName] : []

      // Add key to each relevant pattern set
      for (const pattern of patterns) {
        if (client.sAdd) {
          await client.sAdd(pattern, key)
          // Set TTL on the keyset slightly longer than the cached data
          await client.expire(pattern, ttl + 60)
        }
      }
    } catch (error) {
      // Don't fail if key tracking fails - pattern deletion will fall back to SCAN
      log.warn({ error }, '⚠️ [Redis] Key tracking failed:')
    }
  }

  // Delete cached data
  static async del(key: string): Promise<void> {
    try {
      const client = await getRedisClient()
      await client.del(key)
      this.metrics.deletes++
    } catch (error) {
      log.error({ err: error }, 'Redis del error:')
      this.metrics.errors++
      // Don't throw - cache invalidation failure is not critical
    }
  }

  // Delete multiple keys by pattern (optimized for Upstash)
  static async delPattern(pattern: string): Promise<void> {
    try {
      const client = await getRedisClient()
      this.metrics.patternDeletes++

      // Strategy 1: Try using key sets (fastest for Upstash)
      const keysetName = keysetNameForPattern(pattern)
      let keys: string[] = []

      if (client.sMembers) {
        try {
          keys = await client.sMembers(keysetName)
          if (keys.length > 0) {
            log.info(`✅ [Redis] Pattern delete via keyset: ${keysetName} (${keys.length} keys)`)
            await client.del(keys)
            await client.del(keysetName) // Clean up the keyset itself
            return
          }
        } catch (error) {
          log.warn({ error }, '⚠️ [Redis] Keyset lookup failed, falling back to SCAN:')
        }
      }

      // Strategy 2: Fall back to SCAN/KEYS
      keys = await client.keys(pattern)
      if (keys.length > 0) {
        log.info(`✅ [Redis] Pattern delete via SCAN: ${pattern} (${keys.length} keys)`)
        await client.del(keys)
      } else {
        log.info(`ℹ️ [Redis] No keys found for pattern: ${pattern}`)
      }
    } catch (error) {
      log.error({ err: error }, 'Redis delPattern error:')
      this.metrics.errors++
      // Don't throw - cache invalidation failure is not critical
    }
  }

  // Cache with fallback pattern
  static async getOrSet<T>(
    key: string, 
    fetchFn: () => Promise<T>, 
    ttl: number = this.defaultTTL
  ): Promise<T> {
    // get() and set() already isolate Redis failures, so the loader is the only
    // operation here that can reject. Propagate that rejection once to every
    // coalesced caller; retrying per caller would recreate the stampede.
    const cached = await this.get<T>(key)
    if (cached !== null) {
      log.debug({ cacheKey: key, outcome: 'hit' }, 'Cache lookup')
      return cached
    }

    log.debug({ cacheKey: key, outcome: 'miss' }, 'Cache lookup')

    // Coalesce concurrent misses for the same key: the first caller fetches
    // and caches; the rest await the same in-flight promise instead of each
    // hitting the database.
    const existing = this.inFlight.get(key) as Promise<T> | undefined
    if (existing) {
      this.metrics.coalesced++
      log.debug({ cacheKey: key, outcome: 'coalesced' }, 'Cache load')
      return await existing
    }

    const promise = (async () => {
      this.metrics.loads++
      try {
        const data = await fetchFn()
        await this.set(key, data, ttl)
        return data
      } catch (error) {
        this.metrics.loadErrors++
        throw error
      }
    })()
    this.inFlight.set(key, promise)
    try {
      return await promise
    } finally {
      this.inFlight.delete(key)
    }
  }

  // Generate cache keys for common patterns
  static keys = {
    user: (userId: string) => `user:${userId}`,
    userTasks: (userId: string) => `tasks:user:${userId}`,
    userLists: (userId: string) => `lists:user:${userId}`,
    userListsV1: (userId: string) => `lists:user:${userId}:v1`,
    listTasks: (listId: string) => `tasks:list:${listId}`,
    listMembers: (listId: string) => `members:list:${listId}`,
    publicTasks: () => 'tasks:public',
    userSearch: (query: string) => `users:search:${query}`,
    taskComments: (taskId: string) => `comments:task:${taskId}`,
  }

  // Cache invalidation patterns
  static invalidate = {
    userTasks: async (userId: string, listIds?: string[]) => {
      await this.delPattern(`tasks:user:${userId}*`)
      // Invalidate only the affected per-list caches. The per-list key is global
      // (shared across users), so the old `tasks:list:*` fallback wiped EVERY
      // user's list caches on a single edit — a platform-wide cold reload. Pass
      // listIds; if a caller omits them, warn rather than nuke the namespace.
      if (listIds && listIds.length > 0) {
        await Promise.all(listIds.map(id => this.del(this.keys.listTasks(id))))
      } else {
        log.warn('[Redis] invalidate.userTasks called without listIds — skipping per-list invalidation to avoid a global cache wipe')
      }
      await this.del(this.keys.publicTasks())
    },
    userLists: async (userId: string, listIds?: string[]) => {
      await this.delPattern(`lists:user:${userId}*`)
      // Only the affected lists' member caches. This used to be
      // `members:list:*`, which — because that pattern DOES resolve to a
      // tracked keyset — deleted the cached member set for every list on the
      // platform on a single membership change. The same blast-radius bug was
      // already fixed for tasks a few lines above and missed here
      // (task 21dc1119).
      if (listIds && listIds.length > 0) {
        await Promise.all(listIds.map(id => this.del(this.keys.listMembers(id))))
      }
    },
    /**
     * Clear every cached list set for ONE user — the legacy key and the v1 key —
     * and nothing global.
     *
     * A user's lists are cached twice: `lists:user:<id>` for GET /api/lists and
     * `lists:user:<id>:v1` for GET /api/v1/lists, the one iOS syncs from. Writes
     * that hand-rolled `del(keys.userLists(id))` cleared only the first, so a
     * list changed on web stayed stale on iOS for the rest of the 5-minute TTL
     * (task 070bddf8).
     *
     * Use this, not `invalidate.userLists`, from write paths that change one
     * user's list set. `userLists` additionally wipes `members:list:*` for every
     * list on the account, which is right after a membership change and far too
     * broad after, say, a task update.
     *
     * Best-effort by design: a Redis outage must not fail the write that
     * triggered it. The worst case is a stale read until the TTL expires.
     */
    userListsAllVersions: async (userId: string) => {
      try {
        await Promise.all([
          this.del(this.keys.userLists(userId)),
          this.del(this.keys.userListsV1(userId)),
        ])
      } catch (error) {
        log.error({ err: error }, `Failed to invalidate list caches for user ${userId}`)
      }
    },
    taskUpdate: async (taskId: string, userId: string, listIds?: string[]) => {
      await this.delPattern(`tasks:user:${userId}*`)
      // Same blast-radius guard as userTasks: only clear the affected per-list
      // caches; never fall back to a global `tasks:list:*` wipe.
      if (listIds && listIds.length > 0) {
        await Promise.all(listIds.map(id => this.del(this.keys.listTasks(id))))
      } else {
        log.warn('[Redis] invalidate.taskUpdate called without listIds — skipping per-list invalidation to avoid a global cache wipe')
      }
      await this.delPattern(`comments:task:${taskId}*`)
      await this.del(this.keys.publicTasks())
    },
    listUpdate: async (listId: string, userIds: string[]) => {
      for (const userId of userIds) {
        await this.delPattern(`lists:user:${userId}*`)
        await this.delPattern(`tasks:user:${userId}*`)
      }
      await this.delPattern(`tasks:list:${listId}*`)
      await this.delPattern(`members:list:${listId}*`)
    }
  }
}

// Helper to check if Redis is available
export async function isRedisAvailable(): Promise<boolean> {
  // Fast path: circuit breaker is active, skip connection attempt
  if (Date.now() < redisUnavailableUntil) {
    return false
  }

  try {
    const isProduction = process.env.NODE_ENV === 'production'
    const hasUpstashConfig = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN

    // Check if Redis is configured
    if (isProduction && !hasUpstashConfig) {
      return false
    }
    if (!isProduction && !process.env.REDIS_URL) {
      return false
    }


    const client = await getRedisClient()
    return client && client.isReady
  } catch {
    return false
  }
}