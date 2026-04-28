import { createLogger } from '@/lib/logger'

const log = createLogger('memory-cache')

/**
 * In-Memory LRU Cache with TTL
 * Provides O(1) access for frequently used data
 * Part of three-tier cache: Memory -> IndexedDB -> Network
 */

interface CacheEntry<T> {
  value: T
  expiresAt: number
  accessedAt: number
  createdAt: number
}

interface CacheOptions {
  /** Maximum number of items in cache */
  maxSize: number
  /** Default TTL in milliseconds */
  defaultTTL: number
  /** Name for debugging */
  name: string
}

/**
 * Generic LRU Cache with TTL support
 */
export class MemoryCache<T> {
  private cache = new Map<string, CacheEntry<T>>()
  private readonly maxSize: number
  private readonly defaultTTL: number
  private readonly name: string

  constructor(options: CacheOptions) {
    this.maxSize = options.maxSize
    this.defaultTTL = options.defaultTTL
    this.name = options.name
  }

  /**
   * Get item from cache
   * Returns undefined if not found or expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key)

    if (!entry) {
      return undefined
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }

    // Update access time for LRU
    entry.accessedAt = Date.now()

    return entry.value
  }

  /**
   * Set item in cache with optional TTL
   */
  set(key: string, value: T, ttl?: number): void {
    const now = Date.now()

    // Evict if at max capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU()
    }

    this.cache.set(key, {
      value,
      expiresAt: now + (ttl ?? this.defaultTTL),
      accessedAt: now,
      createdAt: now
    })
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  /**
   * Delete item from cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Delete items matching a predicate
   */
  deleteWhere(predicate: (key: string, value: T) => boolean): number {
    let count = 0
    for (const [key, entry] of this.cache) {
      if (predicate(key, entry.value)) {
        this.cache.delete(key)
        count++
      }
    }
    return count
  }

  /**
   * Get all values (excluding expired)
   */
  values(): T[] {
    const now = Date.now()
    const values: T[] = []

    for (const [key, entry] of this.cache) {
      if (now <= entry.expiresAt) {
        values.push(entry.value)
      } else {
        this.cache.delete(key)
      }
    }

    return values
  }

  /**
   * Get all entries (excluding expired)
   */
  entries(): Array<[string, T]> {
    const now = Date.now()
    const entries: Array<[string, T]> = []

    for (const [key, entry] of this.cache) {
      if (now <= entry.expiresAt) {
        entries.push([key, entry.value])
      } else {
        this.cache.delete(key)
      }
    }

    return entries
  }

  /**
   * Clear all items from cache
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Invalidate (mark expired) but keep for potential stale-while-revalidate
   */
  invalidate(key: string): void {
    const entry = this.cache.get(key)
    if (entry) {
      entry.expiresAt = 0
    }
  }

  /**
   * Invalidate all entries
   */
  invalidateAll(): void {
    for (const entry of this.cache.values()) {
      entry.expiresAt = 0
    }
  }

  /**
   * Get current cache size
   */
  size(): number {
    return this.cache.size
  }

  /**
   * Get cache stats for debugging
   */
  getStats() {
    const now = Date.now()
    let validCount = 0
    let expiredCount = 0

    for (const entry of this.cache.values()) {
      if (now <= entry.expiresAt) {
        validCount++
      } else {
        expiredCount++
      }
    }

    return {
      name: this.name,
      totalSize: this.cache.size,
      validCount,
      expiredCount,
      maxSize: this.maxSize,
      defaultTTL: this.defaultTTL
    }
  }

  /**
   * Evict least recently used item
   */
  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestAccess = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.accessedAt < oldestAccess) {
        oldestAccess = entry.accessedAt
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)

      if (process.env.NODE_ENV === 'development') {
        log.info(`🗑️ [${this.name}] Evicted LRU item: ${oldestKey}`)
      }
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    const now = Date.now()
    let removed = 0

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key)
        removed++
      }
    }

    return removed
  }
}

/**
 * Collection cache for lists of items with TTL
 */
export class CollectionCache<T> {
  private cache = new Map<string, {
    items: T[]
    expiresAt: number
    accessedAt: number
  }>()
  private readonly maxCollections: number
  private readonly defaultTTL: number
  private readonly name: string

  constructor(options: CacheOptions) {
    this.maxCollections = options.maxSize
    this.defaultTTL = options.defaultTTL
    this.name = options.name
  }

  /**
   * Get collection from cache
   */
  get(key: string): T[] | undefined {
    const entry = this.cache.get(key)

    if (!entry) {
      return undefined
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }

    entry.accessedAt = Date.now()
    return entry.items
  }

  /**
   * Set collection in cache
   */
  set(key: string, items: T[], ttl?: number): void {
    const now = Date.now()

    if (this.cache.size >= this.maxCollections && !this.cache.has(key)) {
      this.evictLRU()
    }

    this.cache.set(key, {
      items,
      expiresAt: now + (ttl ?? this.defaultTTL),
      accessedAt: now
    })
  }

  /**
   * Add item to collection
   */
  addToCollection(key: string, item: T, getId: (item: T) => string): void {
    const entry = this.cache.get(key)
    if (!entry || Date.now() > entry.expiresAt) return

    const id = getId(item)
    const existingIndex = entry.items.findIndex(i => getId(i) === id)

    if (existingIndex >= 0) {
      entry.items[existingIndex] = item
    } else {
      entry.items.push(item)
    }

    entry.accessedAt = Date.now()
  }

  /**
   * Update item in collection
   */
  updateInCollection(
    key: string,
    itemId: string,
    updater: (item: T) => T,
    getId: (item: T) => string
  ): boolean {
    const entry = this.cache.get(key)
    if (!entry || Date.now() > entry.expiresAt) return false

    const index = entry.items.findIndex(i => getId(i) === itemId)
    if (index >= 0) {
      entry.items[index] = updater(entry.items[index])
      entry.accessedAt = Date.now()
      return true
    }

    return false
  }

  /**
   * Remove item from collection
   */
  removeFromCollection(
    key: string,
    itemId: string,
    getId: (item: T) => string
  ): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    const initialLength = entry.items.length
    entry.items = entry.items.filter(i => getId(i) !== itemId)

    return entry.items.length < initialLength
  }

  /**
   * Check if collection exists and is valid
   */
  has(key: string): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  /**
   * Delete collection
   */
  delete(key: string): boolean {
    return this.cache.delete(key)
  }

  /**
   * Invalidate collection
   */
  invalidate(key: string): void {
    const entry = this.cache.get(key)
    if (entry) {
      entry.expiresAt = 0
    }
  }

  /**
   * Invalidate all collections
   */
  invalidateAll(): void {
    for (const entry of this.cache.values()) {
      entry.expiresAt = 0
    }
  }

  /**
   * Clear all collections
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache stats
   */
  getStats() {
    const now = Date.now()
    let validCount = 0
    let totalItems = 0

    for (const entry of this.cache.values()) {
      if (now <= entry.expiresAt) {
        validCount++
        totalItems += entry.items.length
      }
    }

    return {
      name: this.name,
      collections: this.cache.size,
      validCollections: validCount,
      totalItems,
      maxCollections: this.maxCollections
    }
  }

  /**
   * Evict least recently used collection
   */
  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestAccess = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.accessedAt < oldestAccess) {
        oldestAccess = entry.accessedAt
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }
}

// TTL Constants (in milliseconds)
export const CACHE_TTL = {
  TASKS: 5 * 60 * 1000,       // 5 minutes - frequently updated
  LISTS: 15 * 60 * 1000,      // 15 minutes - less frequently updated
  COMMENTS: 10 * 60 * 1000,   // 10 minutes
  USERS: 60 * 60 * 1000,      // 1 hour - rarely changes
  MEMBERS: 15 * 60 * 1000,    // 15 minutes
  ATTACHMENTS: 30 * 60 * 1000 // 30 minutes
} as const

// Cache size limits
export const CACHE_SIZES = {
  TASKS: 500,        // Max 500 tasks in memory
  LISTS: 100,        // Max 100 lists
  COMMENTS: 1000,    // Max 1000 comments
  USERS: 200,        // Max 200 users
  MEMBERS: 500,      // Max 500 member records
  COLLECTIONS: 50    // Max 50 collection queries
} as const
