import { createLogger } from '@/lib/logger'
import { offlineDB } from './database'
import type { OfflineAttachment } from './types'

const log = createLogger('offline-db')

/**
 * Attachment operations with offline support and blob caching
 */
export class OfflineAttachmentOperations {
  // Maximum cache size in bytes (100MB)
  private static readonly MAX_CACHE_SIZE = 100 * 1024 * 1024

  /**
   * Get attachment by ID
   */
  static async getAttachment(id: string): Promise<OfflineAttachment | undefined> {
    const attachment = await offlineDB.attachments.get(id)
    if (attachment) {
      // Update access time for LRU
      await offlineDB.attachments.update(id, { accessedAt: Date.now() })
    }
    return attachment
  }

  /**
   * Get attachments by task ID
   */
  static async getAttachmentsByTask(taskId: string): Promise<OfflineAttachment[]> {
    return await offlineDB.attachments.where('taskId').equals(taskId).toArray()
  }

  /**
   * Get attachments by comment ID
   */
  static async getAttachmentsByComment(commentId: string): Promise<OfflineAttachment[]> {
    return await offlineDB.attachments.where('commentId').equals(commentId).toArray()
  }

  /**
   * Save attachment metadata (without blob)
   */
  static async saveAttachment(attachment: OfflineAttachment): Promise<void> {
    await offlineDB.attachments.put(attachment)
  }

  /**
   * Save attachment with blob data
   */
  static async saveAttachmentWithBlob(attachment: OfflineAttachment, blob: Blob): Promise<void> {
    // Check if we need to evict old attachments
    await this.ensureCacheSpace(blob.size)

    await offlineDB.attachments.put({
      ...attachment,
      blob,
      cachedAt: Date.now(),
      accessedAt: Date.now()
    })
  }

  /**
   * Delete attachment from offline storage
   */
  static async deleteAttachment(id: string): Promise<void> {
    await offlineDB.attachments.delete(id)
  }

  /**
   * Get total cache size
   */
  static async getCacheSize(): Promise<number> {
    const attachments = await offlineDB.attachments.toArray()
    return attachments.reduce((total, att) => total + (att.blob?.size || 0), 0)
  }

  /**
   * Ensure there's enough space in cache, evicting LRU items if needed
   */
  private static async ensureCacheSpace(neededBytes: number): Promise<void> {
    let currentSize = await this.getCacheSize()

    if (currentSize + neededBytes <= this.MAX_CACHE_SIZE) {
      return
    }

    // Get all attachments sorted by access time (oldest first)
    const attachments = await offlineDB.attachments
      .orderBy('accessedAt')
      .toArray()

    // Evict until we have enough space
    for (const attachment of attachments) {
      if (currentSize + neededBytes <= this.MAX_CACHE_SIZE) {
        break
      }

      if (attachment.blob) {
        const blobSize = attachment.blob.size
        // Remove blob but keep metadata
        await offlineDB.attachments.update(attachment.id, { blob: undefined })
        currentSize -= blobSize

        if (process.env.NODE_ENV === 'development') {
          log.info(`🗑️ Evicted attachment blob: ${attachment.name} (${blobSize} bytes)`)
        }
      }
    }
  }

  /**
   * Clear all attachment blobs (keep metadata)
   */
  static async clearBlobs(): Promise<void> {
    const attachments = await offlineDB.attachments.toArray()
    for (const attachment of attachments) {
      if (attachment.blob) {
        await offlineDB.attachments.update(attachment.id, { blob: undefined })
      }
    }
  }

  /**
   * Clear all attachments
   */
  static async clearAttachments(): Promise<void> {
    await offlineDB.attachments.clear()
  }
}
