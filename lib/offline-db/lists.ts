import type { TaskList } from '@/types/task'
import { offlineDB } from './database'

/**
 * List operations with offline support
 * All operations are safe and will not throw on IndexedDB errors
 */
export class OfflineListOperations {
  /**
   * Get all lists (offline-first)
   */
  static async getLists(): Promise<TaskList[]> {
    return await offlineDB.safeOperation(
      () => offlineDB.lists.toArray(),
      []
    )
  }

  /**
   * Get list by ID
   */
  static async getList(id: string): Promise<TaskList | undefined> {
    return await offlineDB.safeOperation(
      () => offlineDB.lists.get(id),
      undefined
    )
  }

  /**
   * Save list to offline storage
   */
  static async saveList(list: TaskList): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.lists.put(list),
      undefined
    )
  }

  /**
   * Save multiple lists (bulk operation)
   */
  static async saveLists(lists: TaskList[]): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.lists.bulkPut(lists),
      undefined
    )
  }

  /**
   * Delete list from offline storage
   */
  static async deleteList(id: string): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.lists.delete(id),
      undefined
    )
  }

  /**
   * Clear all lists
   */
  static async clearLists(): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.lists.clear(),
      undefined
    )
  }
}
