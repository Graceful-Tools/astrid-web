import { offlineDB } from './database'
import type { SyncCursor } from './types'

/**
 * Sync cursor operations for incremental sync
 */
export class OfflineSyncCursorOperations {
  /**
   * Get cursor for entity type
   */
  static async getCursor(entity: SyncCursor['entity']): Promise<SyncCursor | undefined> {
    return await offlineDB.syncCursors.get(entity)
  }

  /**
   * Set cursor for entity type
   */
  static async setCursor(entity: SyncCursor['entity'], cursor: string): Promise<void> {
    await offlineDB.syncCursors.put({
      entity,
      cursor,
      lastSync: Date.now()
    })
  }

  /**
   * Get all cursors
   */
  static async getAllCursors(): Promise<SyncCursor[]> {
    return await offlineDB.syncCursors.toArray()
  }

  /**
   * Clear cursor for entity type
   */
  static async clearCursor(entity: SyncCursor['entity']): Promise<void> {
    await offlineDB.syncCursors.delete(entity)
  }

  /**
   * Clear all cursors (force full sync)
   */
  static async clearAllCursors(): Promise<void> {
    await offlineDB.syncCursors.clear()
  }
}
