/**
 * Attachment Cache Manager
 * Handles downloading and caching attachments for offline viewing
 *
 * Features:
 * - Automatic caching on view
 * - LRU eviction with 100MB limit
 * - Background prefetching for favorite lists
 * - Blob storage in IndexedDB
 * - Graceful handling of quota exceeded errors
 */

import {
  offlineDB,
  OfflineAttachmentOperations,
  type OfflineAttachment
} from './offline-db'
import { CrossTabSync } from './cross-tab-sync'
import { createLogger } from '@/lib/logger'

const log = createLogger('attachment-cache')


// Maximum cache size (100MB)
const MAX_CACHE_SIZE = 100 * 1024 * 1024

// Minimum space to free when evicting (20MB)
const EVICTION_TARGET = 20 * 1024 * 1024

export interface AttachmentCacheResult {
  blob: Blob | null
  url: string
  isCached: boolean
  isDownloading: boolean
  error?: string
}

/**
 * Attachment Cache Manager - Singleton
 */
class AttachmentCacheManagerClass {
  // Track ongoing downloads to prevent duplicates
  private downloadQueue = new Map<string, Promise<Blob | null>>()

  // Cache stats
  private stats = {
    hits: 0,
    misses: 0,
    downloads: 0,
    errors: 0
  }

  /**
   * Get attachment blob (checks cache, downloads if needed)
   * Note: Caller is responsible for revoking blob URLs when done
   */
  async getAttachment(
    attachmentId: string,
    url: string,
    options?: {
      download?: boolean  // Auto-download if not cached (default: true)
      taskId?: string
      commentId?: string
      name?: string
      mimeType?: string
      size?: number
    }
  ): Promise<AttachmentCacheResult> {
    const shouldDownload = options?.download !== false

    // Check cache first
    try {
      const cached = await OfflineAttachmentOperations.getAttachment(attachmentId)

      if (cached?.blob) {
        this.stats.hits++
        return {
          blob: cached.blob,
          url: URL.createObjectURL(cached.blob),
          isCached: true,
          isDownloading: false
        }
      }
    } catch (error) {
      log.error({ err: error }, `❌ [AttachmentCache] Failed to read from cache:`)
      // Continue to download
    }

    this.stats.misses++

    // Check if already downloading
    const existingDownload = this.downloadQueue.get(attachmentId)
    if (existingDownload) {
      const blob = await existingDownload
      return {
        blob,
        url: blob ? URL.createObjectURL(blob) : url,
        isCached: !!blob,
        isDownloading: false
      }
    }

    // Download if online and allowed
    if (shouldDownload && navigator.onLine) {
      const downloadPromise = this.downloadAndCache(attachmentId, url, {
        taskId: options?.taskId,
        commentId: options?.commentId,
        name: options?.name || 'attachment',
        mimeType: options?.mimeType || 'application/octet-stream',
        size: options?.size || 0
      })

      this.downloadQueue.set(attachmentId, downloadPromise)

      try {
        const blob = await downloadPromise
        return {
          blob,
          url: blob ? URL.createObjectURL(blob) : url,
          isCached: !!blob,
          isDownloading: false
        }
      } finally {
        this.downloadQueue.delete(attachmentId)
      }
    }

    // Offline or download disabled - return original URL
    return {
      blob: null,
      url,
      isCached: false,
      isDownloading: false,
      error: !navigator.onLine ? 'Offline - attachment not cached' : undefined
    }
  }

  /**
   * Download and cache attachment
   */
  private async downloadAndCache(
    attachmentId: string,
    url: string,
    metadata: {
      taskId?: string
      commentId?: string
      name: string
      mimeType: string
      size: number
    }
  ): Promise<Blob | null> {
    try {
      this.stats.downloads++

      const response = await fetch(url, {
        credentials: 'include'
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const blob = await response.blob()

      // Check if we need to evict before saving
      await this.ensureSpace(blob.size)

      // Save to IndexedDB
      const attachment: OfflineAttachment = {
        id: attachmentId,
        taskId: metadata.taskId,
        commentId: metadata.commentId,
        name: metadata.name,
        mimeType: metadata.mimeType || blob.type,
        size: blob.size,
        url,
        cachedAt: Date.now(),
        accessedAt: Date.now(),
        syncStatus: 'synced'
      }

      try {
        await OfflineAttachmentOperations.saveAttachmentWithBlob(attachment, blob)
      } catch (saveError) {
        // Handle quota exceeded error
        if (this.isQuotaError(saveError)) {
          log.warn(`⚠️ [AttachmentCache] Quota exceeded, attempting eviction...`)
          await this.evictLRU(blob.size + EVICTION_TARGET)

          // Retry save after eviction
          try {
            await OfflineAttachmentOperations.saveAttachmentWithBlob(attachment, blob)
          } catch (retryError) {
            // If still fails, log and return blob without caching
            log.warn(`⚠️ [AttachmentCache] Could not cache attachment after eviction, returning uncached blob`)
            return blob
          }
        } else {
          throw saveError
        }
      }

      // Broadcast to other tabs
      CrossTabSync.broadcastCacheUpdated('attachment', attachmentId)

      if (process.env.NODE_ENV === 'development') {
        log.info(`📦 Cached attachment: ${metadata.name} (${blob.size} bytes)`)
      }

      return blob
    } catch (error) {
      this.stats.errors++
      log.error({ err: error }, `❌ Failed to download attachment ${attachmentId}:`)
      return null
    }
  }

  /**
   * Check if error is a quota exceeded error
   */
  private isQuotaError(error: unknown): boolean {
    if (error instanceof Error) {
      // Check for various quota exceeded error patterns
      const message = error.message.toLowerCase()
      return (
        error.name === 'QuotaExceededError' ||
        message.includes('quota') ||
        message.includes('storage') ||
        message.includes('full')
      )
    }
    return false
  }

  /**
   * Ensure there's enough space for a new attachment
   */
  private async ensureSpace(requiredBytes: number): Promise<void> {
    const currentSize = await OfflineAttachmentOperations.getCacheSize()
    const availableSpace = MAX_CACHE_SIZE - currentSize

    if (availableSpace < requiredBytes) {
      const spaceToFree = requiredBytes - availableSpace + EVICTION_TARGET
      await this.evictLRU(spaceToFree)
    }
  }

  /**
   * Evict least recently used attachments to free space
   */
  private async evictLRU(bytesToFree: number): Promise<void> {
    if (bytesToFree <= 0) return

    try {
      // Get all attachments sorted by accessedAt (oldest first)
      const allAttachments = await offlineDB.attachments
        .orderBy('accessedAt')
        .toArray()

      let freedBytes = 0
      const toDelete: string[] = []

      for (const attachment of allAttachments) {
        if (freedBytes >= bytesToFree) break

        toDelete.push(attachment.id)
        freedBytes += attachment.size || 0
      }

      // Delete evicted attachments
      for (const id of toDelete) {
        await OfflineAttachmentOperations.deleteAttachment(id)
      }

      if (process.env.NODE_ENV === 'development' && toDelete.length > 0) {
        log.info(`🗑️ [AttachmentCache] Evicted ${toDelete.length} attachments, freed ${(freedBytes / 1024 / 1024).toFixed(2)}MB`)
      }
    } catch (error) {
      log.error({ err: error }, '❌ [AttachmentCache] Failed to evict attachments:')
    }
  }

  /**
   * Prefetch attachments for a task (background)
   */
  async prefetchForTask(
    taskId: string,
    attachments: Array<{
      id: string
      url: string
      name?: string
      mimeType?: string
      size?: number
    }>
  ): Promise<void> {
    if (!navigator.onLine) return

    for (const attachment of attachments) {
      // Skip if already cached
      const cached = await OfflineAttachmentOperations.getAttachment(attachment.id)
      if (cached?.blob) continue

      // Download in background (don't await)
      this.getAttachment(attachment.id, attachment.url, {
        taskId,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size
      }).catch(() => {
        // Ignore errors in background prefetch
      })
    }
  }

  /**
   * Check if attachment is cached
   */
  async isCached(attachmentId: string): Promise<boolean> {
    const cached = await OfflineAttachmentOperations.getAttachment(attachmentId)
    return !!cached?.blob
  }

  /**
   * Get cached blob URL (returns null if not cached)
   */
  async getCachedBlobUrl(attachmentId: string): Promise<string | null> {
    const cached = await OfflineAttachmentOperations.getAttachment(attachmentId)
    if (cached?.blob) {
      return URL.createObjectURL(cached.blob)
    }
    return null
  }

  /**
   * Remove attachment from cache
   */
  async removeFromCache(attachmentId: string): Promise<void> {
    await OfflineAttachmentOperations.deleteAttachment(attachmentId)
    CrossTabSync.broadcastEntityDeleted('attachment', attachmentId)
  }

  /**
   * Clear entire attachment cache
   */
  async clearCache(): Promise<void> {
    await OfflineAttachmentOperations.clearAttachments()

    if (process.env.NODE_ENV === 'development') {
      log.info('🗑️ Attachment cache cleared')
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats() {
    const size = await OfflineAttachmentOperations.getCacheSize()
    const info = await offlineDB.getStorageInfo()

    return {
      ...this.stats,
      cachedCount: info.attachments,
      cacheSize: size,
      cacheSizeMB: (size / (1024 * 1024)).toFixed(2)
    }
  }

  /**
   * Check if downloading
   */
  isDownloading(attachmentId: string): boolean {
    return this.downloadQueue.has(attachmentId)
  }
}

// Singleton instance
export const AttachmentCache = new AttachmentCacheManagerClass()

// Export default
export default AttachmentCache
