import type { Task } from '@/types/task'
import { offlineDB } from './database'

const inList = (listId: string) => (task: Task) => task.lists?.some(list => list.id === listId) ?? false

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
   * The cached tasks of one list the user is viewing but does not belong to
   * (AWTD-1451). Filtered in memory: rows carry `lists`, not the `listId` the
   * table's index names, and the table only holds lists the user has opened.
   */
  static async getListTasks(listId: string): Promise<Task[]> {
    return (await offlineDB.publicTasks.toArray()).filter(inList(listId))
  }

  /**
   * Make the cache for one list match what the server just returned: rows of
   * this list that are no longer in it go, the rest are upserted (AWTD-1451).
   */
  static async replaceListTasks(listId: string, tasks: Task[]): Promise<void> {
    const keep = new Set(tasks.map(task => task.id))
    const stale = (await offlineDB.publicTasks.toArray())
      .filter(task => inList(listId)(task) && !keep.has(task.id))
      .map(task => task.id)
    if (stale.length > 0) await offlineDB.publicTasks.bulkDelete(stale)
    if (tasks.length > 0) await offlineDB.publicTasks.bulkPut(tasks)
  }

  /**
   * Clear all public tasks
   */
  static async clearPublicTasks(): Promise<void> {
    await offlineDB.publicTasks.clear()
  }
}
