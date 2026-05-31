import { offlineDB } from './database'

/**
 * ID mapping operations for temp-to-real ID conversion
 */
export class OfflineIdMappingOperations {
  /**
   * Save ID mapping
   */
  static async saveMapping(tempId: string, realId: string, entity: 'task' | 'list' | 'comment' | 'member' | 'attachment'): Promise<void> {
    await offlineDB.idMappings.put({
      tempId,
      realId,
      entity,
      timestamp: Date.now()
    })
  }

  /**
   * Get real ID from temp ID
   */
  static async getRealId(tempId: string): Promise<string | undefined> {
    const mapping = await offlineDB.idMappings.get(tempId)
    return mapping?.realId
  }

  /**
   * Get temp ID from real ID
   */
  static async getTempId(realId: string): Promise<string | undefined> {
    const mapping = await offlineDB.idMappings.where('realId').equals(realId).first()
    return mapping?.tempId
  }

  /**
   * Clear old mappings (older than specified time)
   */
  static async clearOldMappings(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const cutoffTime = Date.now() - olderThanMs
    const oldMappings = await offlineDB.idMappings
      .where('timestamp')
      .below(cutoffTime)
      .toArray()

    if (oldMappings.length > 0) {
      const tempIds = oldMappings.map(m => m.tempId)
      await offlineDB.idMappings.bulkDelete(tempIds)
    }
  }
}
