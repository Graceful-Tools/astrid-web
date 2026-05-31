import type { Comment } from '@/types/task'
import { offlineDB } from './database'

/**
 * Comment operations with offline support
 * All operations are safe and will not throw on IndexedDB errors
 */
export class OfflineCommentOperations {
  /**
   * Get all comments for a task
   */
  static async getCommentsByTask(taskId: string): Promise<Comment[]> {
    return await offlineDB.safeOperation(
      () => offlineDB.comments.where('taskId').equals(taskId).toArray(),
      []
    )
  }

  /**
   * Get comment by ID
   */
  static async getComment(id: string): Promise<Comment | undefined> {
    return await offlineDB.safeOperation(
      () => offlineDB.comments.get(id),
      undefined
    )
  }

  /**
   * Save comment to offline storage
   */
  static async saveComment(comment: Comment): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.comments.put(comment),
      undefined
    )
  }

  /**
   * Save multiple comments (bulk operation)
   */
  static async saveComments(comments: Comment[]): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.comments.bulkPut(comments),
      undefined
    )
  }

  /**
   * Save all comments for a specific task (bulk operation with replacement)
   * Efficiently updates the cache when fetching fresh data for a task
   */
  static async saveCommentsByTask(taskId: string, comments: Comment[]): Promise<void> {
    await offlineDB.safeOperation(
      async () => {
        // Delete existing comments for this task first to ensure clean state
        await offlineDB.comments.where('taskId').equals(taskId).delete()
        // Then save the new comments
        await offlineDB.comments.bulkPut(comments)
      },
      undefined
    )
  }

  /**
   * Delete comment from offline storage
   */
  static async deleteComment(id: string): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.comments.delete(id),
      undefined
    )
  }

  /**
   * Clear all comments
   */
  static async clearComments(): Promise<void> {
    await offlineDB.safeOperation(
      () => offlineDB.comments.clear(),
      undefined
    )
  }
}
