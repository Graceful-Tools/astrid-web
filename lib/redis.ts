import { createClient } from 'redis'
import { Redis as UpstashRedis } from '@upstash/redis'

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
      console.log('[Redis] Using Upstash REST API for production')
      upstashRedis = new UpstashRedis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!
      })
      isUsingUpstash = true

      // Return adapter that matches standard Redis client interface
      return createUpstashAdapter(upstashRedis)
    } else if (process.env.REDIS_URL) {
      // Development: Use local Redis server
      console.log('[Redis] Using local Redis server')
      redis = createClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: false, // Don't auto-reconnect; use circuit breaker instead
          connectTimeout: 3_000,
        }
      })
    } else {
      // No Redis configured - skip connection
      console.log('[Redis] No REDIS_URL configured, skipping Redis')
      return null
    }

    // Only set up event handlers for standard Redis client
    if (redis) {
      redis.on('error', (err) => {
        // Only log once, not on every reconnect attempt
        if (Date.now() >= redisUnavailableUntil) {
          console.error('[Redis] Client error:', err.message || err)
        }
        redis = null
        redisUnavailableUntil = Date.now() + REDIS_BACKOFF_MS
      })

      redis.on('connect', () => {
        console.log('[Redis] Client connected')
        redisUnavailableUntil = 0 // Reset circuit breaker on success
      })

      redis.on('ready', () => {
        console.log('[Redis] Client ready')
      })

      redis.on('end', () => {
        console.log('[Redis] Client disconnected')
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
    console.warn(`[Redis] Unavailable (will retry in ${REDIS_BACKOFF_MS / 1000}s): ${msg}`)
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
        console.error('⚠️ [Redis] Upstash SCAN error:', error)
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
export class RedisCache {
  private static defaultTTL = 300 // 5 minutes default TTL

  // Cache metrics
  private static metrics = {
    hits: 0,
    misses: 0,
    errors: 0,
    sets: 0,
    deletes: 0,
    patternDeletes: 0
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
      patternDeletes: 0
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
      console.error('Redis get error:', error)
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
      console.error('Redis set error:', error)
      this.metrics.errors++
      // Don't throw - caching is optional
    }
  }

  // Track key in pattern sets for efficient deletion
  private static async trackKeyInSets(key: string, ttl: number, client: any): Promise<void> {
    try {
      // Determine which pattern sets this key belongs to
      const patterns: string[] = []

      if (key.startsWith('tasks:user:')) {
        patterns.push('keyset:tasks:user:')
      }
      if (key.startsWith('tasks:list:')) {
        patterns.push('keyset:tasks:list:')
      }
      if (key.startsWith('lists:user:')) {
        patterns.push('keyset:lists:user:')
      }
      if (key.startsWith('members:list:')) {
        patterns.push('keyset:members:list:')
      }
      if (key.startsWith('public_lists:')) {
        patterns.push('keyset:public_lists:')
      }
      if (key.startsWith('comments:task:')) {
        patterns.push('keyset:comments:task:')
      }

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
      console.warn('⚠️ [Redis] Key tracking failed:', error)
    }
  }

  // Delete cached data
  static async del(key: string): Promise<void> {
    try {
      const client = await getRedisClient()
      await client.del(key)
      this.metrics.deletes++
    } catch (error) {
      console.error('Redis del error:', error)
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
      const keysetName = `keyset:${pattern.replace('*', '')}`
      let keys: string[] = []

      if (client.sMembers) {
        try {
          keys = await client.sMembers(keysetName)
          if (keys.length > 0) {
            console.log(`✅ [Redis] Pattern delete via keyset: ${keysetName} (${keys.length} keys)`)
            await client.del(keys)
            await client.del(keysetName) // Clean up the keyset itself
            return
          }
        } catch (error) {
          console.warn('⚠️ [Redis] Keyset lookup failed, falling back to SCAN:', error)
        }
      }

      // Strategy 2: Fall back to SCAN/KEYS
      keys = await client.keys(pattern)
      if (keys.length > 0) {
        console.log(`✅ [Redis] Pattern delete via SCAN: ${pattern} (${keys.length} keys)`)
        await client.del(keys)
      } else {
        console.log(`ℹ️ [Redis] No keys found for pattern: ${pattern}`)
      }
    } catch (error) {
      console.error('Redis delPattern error:', error)
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
    try {
      // Check if Redis is available first
      const isAvailable = await isRedisAvailable()
      if (!isAvailable) {
        console.log('Redis not available, using direct database fetch')
        return await fetchFn()
      }

      // Try to get from cache first
      const cached = await this.get<T>(key)
      if (cached !== null) {
        console.log(`✅ Cache hit: ${key}`)
        return cached
      }

      // Cache miss - fetch data
      console.log(`❌ Cache miss: ${key}`)
      const data = await fetchFn()
      
      // Cache the result for next time
      await this.set(key, data, ttl)
      
      return data
    } catch (error) {
      console.error('Redis getOrSet error:', error)
      // Fallback to direct fetch if Redis fails
      return await fetchFn()
    }
  }

  // Generate cache keys for common patterns
  static keys = {
    user: (userId: string) => `user:${userId}`,
    userTasks: (userId: string) => `tasks:user:${userId}`,
    userLists: (userId: string) => `lists:user:${userId}`,
    listTasks: (listId: string) => `tasks:list:${listId}`,
    listMembers: (listId: string) => `members:list:${listId}`,
    publicTasks: () => 'tasks:public',
    userSearch: (query: string) => `users:search:${query}`,
    taskComments: (taskId: string) => `comments:task:${taskId}`,
  }

  // Cache invalidation patterns
  static invalidate = {
    userTasks: async (userId: string) => {
      await this.delPattern(`tasks:user:${userId}*`)
      await this.delPattern(`tasks:list:*`) // Tasks might be in multiple lists
      await this.del(this.keys.publicTasks())
    },
    userLists: async (userId: string) => {
      await this.delPattern(`lists:user:${userId}*`)
      await this.delPattern(`members:list:*`)
    },
    taskUpdate: async (taskId: string, userId: string) => {
      await this.delPattern(`tasks:user:${userId}*`)
      await this.delPattern(`tasks:list:*`)
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