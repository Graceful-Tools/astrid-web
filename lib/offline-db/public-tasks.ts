import type { Task } from '@/types/task'
import { offlineDB } from './database'

/**
 * Public task operations with offline support
 */
export class OfflinePublicTaskOperations {
  /**
   * Get all public tasks
   */
  static async getPublicTasks(): Promise<Task[]> {
    return await offlineDB.publicTasks.toArray()
  }

  /**
   * Save public task to offline storage
   */
  static async savePublicTask(task: Task): Promise<void> {
    await offlineDB.publicTasks.put(task)
  }

  /**
   * Save multiple public tasks (bulk operation)
   */
  static async savePublicTasks(tasks: Task[]): Promise<void> {
    await offlineDB.publicTasks.bulkPut(tasks)
  }

  /**
   * Clear all public tasks
   */
  static async clearPublicTasks(): Promise<void> {
    await offlineDB.publicTasks.clear()
  }
}
