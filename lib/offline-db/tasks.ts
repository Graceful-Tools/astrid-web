import type { Task } from '@/types/task'
import { offlineDB } from './database'

/**
 * Task operations with offline support
 * All operations are safe and will not throw on IndexedDB errors
 */
export class OfflineTaskOperations {
  /**
   * Get all tasks (offline-first)
   */
  static async getTasks(): Promise<Task[]> {
    return await offlineDB.safeOperation(
      () => offlineDB.tasks.toArray(),
      []
    )
  }

  /**
   * Get task by ID
   */
  static async getTask(id: string): Promise<Task | undefined> {
    return await offlineDB.safeOperation(
      () => offlineDB.tasks.get(id),
      undefined
    )
  }

  /**
   * Get tasks by list ID
   */
  static async getTasksByList(listId: string): Promise<Task[]> {
    return await offlineDB.safeOperation(
      () => offlineDB.tasks.where('listId').equals(listId).toArray(),
      []
    )
  }

  /**
   * Save task to offline storage
   */
  static async saveTask(task: Task): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.tasks.put(task),
      undefined
    )
  }

  /**
   * Save multiple tasks (bulk operation)
   */
  static async saveTasks(tasks: Task[]): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.tasks.bulkPut(tasks),
      undefined
    )
  }

  /**
   * Delete task from offline storage
   */
  static async deleteTask(id: string): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.tasks.delete(id),
      undefined
    )
  }

  /**
   * Clear all tasks
   */
  static async clearTasks(): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.tasks.clear(),
      undefined
    )
  }
}
