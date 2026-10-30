import type { Task } from '@/types/task'
import { offlineDB } from './database'

/**
 * Task operations with offline support
 * All operations are safe and will not throw on IndexedDB errors
 */
/**
 * Apply queued, unsynced task updates on top of stored tasks (AWTD-1417).
 *
 * Everything in the mutation queue is newer than the cache: a mutation is
 * deleted once it syncs. An edit made offline before the initial sync had
 * stored the task was only queued, and the sync then stored the server's older
 * copy, so a reload offline showed the edit as lost while it waited to sync.
 */
async function withQueuedEdits(tasks: Task[]): Promise<Task[]> {
  if (tasks.length === 0) return tasks
  const edits = await offlineDB.safeOperation(
    () => offlineDB.mutations.where('entity').equals('task').filter(m => m.type === 'update').sortBy('timestamp'),
    []
  )
  if (edits.length === 0) return tasks
  return tasks.map(task => edits
    .filter(edit => edit.entityId === task.id && edit.data && typeof edit.data === 'object')
    .reduce((current, edit) => ({ ...current, ...edit.data }), task))
}

export class OfflineTaskOperations {
  /**
   * Get all tasks (offline-first), with queued edits applied
   */
  static async getTasks(): Promise<Task[]> {
    return withQueuedEdits(await offlineDB.safeOperation(
      () => offlineDB.tasks.toArray(),
      []
    ))
  }

  /**
   * Get task by ID, with queued edits applied
   */
  static async getTask(id: string): Promise<Task | undefined> {
    const task = await offlineDB.safeOperation(
      () => offlineDB.tasks.get(id),
      undefined
    )
    return task ? (await withQueuedEdits([task]))[0] : undefined
  }

  /**
   * Get tasks by list ID
   *
   * Matches on `lists[].id`. The table's `listId` index is never populated —
   * a Task has no `listId` field — so querying it always found nothing (AWTD-1350).
   */
  static async getTasksByList(listId: string): Promise<Task[]> {
    return withQueuedEdits(await offlineDB.safeOperation(
      () => offlineDB.tasks
        .filter(task => task.lists?.some(list => list.id === listId) ?? false)
        .toArray(),
      []
    ))
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
