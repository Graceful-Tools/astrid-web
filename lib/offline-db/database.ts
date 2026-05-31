import Dexie, { Table } from 'dexie'
import type { Task, TaskList, Comment } from '@/types/task'
import { createLogger } from '@/lib/logger'
import type {
  OfflineUser,
  MutationOperation,
  OfflineListMember,
  OfflineAttachment,
  SyncCursor,
  IdMapping,
} from './types'

const log = createLogger('offline-db')

// Track if IndexedDB is available and working
let indexedDBAvailable = true
let indexedDBError: Error | null = null

/**
 * Offline-first database using Dexie (IndexedDB wrapper)
 * Stores tasks, lists, users, comments, attachments, members, and mutation queue for sync
 */
class OfflineDatabase extends Dexie {
  tasks!: Table<Task, string>
  lists!: Table<TaskList, string>
  users!: Table<OfflineUser, string>
  publicTasks!: Table<Task, string>
  comments!: Table<Comment, string>
  mutations!: Table<MutationOperation, string>
  idMappings!: Table<IdMapping, string>
  listMembers!: Table<OfflineListMember, string>
  attachments!: Table<OfflineAttachment, string>
  syncCursors!: Table<SyncCursor, string>

  constructor() {
    super('AstridOfflineDB')

    // Version 1: Original schema
    this.version(1).stores({
      tasks: 'id, listId, assignedToId, dueDate, completed, updatedAt',
      lists: 'id, ownerId, privacy, updatedAt, isFavorite',
      users: 'id, email',
      publicTasks: 'id, listId, updatedAt',
      mutations: 'id, type, entity, entityId, timestamp, status'
    })

    // Version 2: Add comments, idMappings, and enhance mutations
    this.version(2).stores({
      tasks: 'id, listId, assignedToId, dueDate, completed, updatedAt',
      lists: 'id, ownerId, privacy, updatedAt, isFavorite',
      users: 'id, email',
      publicTasks: 'id, listId, updatedAt',
      comments: 'id, taskId, authorId, createdAt',
      mutations: 'id, type, entity, entityId, timestamp, status, parentId',
      idMappings: 'tempId, realId, entity, timestamp'
    })

    // Version 3: Add listMembers, attachments, syncCursors for full offline support
    this.version(3).stores({
      tasks: 'id, listId, assignedToId, dueDate, completed, updatedAt',
      lists: 'id, ownerId, privacy, updatedAt, isFavorite',
      users: 'id, email',
      publicTasks: 'id, listId, updatedAt',
      comments: 'id, taskId, authorId, createdAt',
      mutations: 'id, type, entity, entityId, timestamp, status, parentId',
      idMappings: 'tempId, realId, entity, timestamp',
      listMembers: 'id, listId, userId, role, syncStatus',
      attachments: 'id, taskId, commentId, cachedAt, accessedAt, syncStatus',
      syncCursors: 'entity, lastSync'
    })

    // Handle database open errors
    this.on('blocked', () => {
      log.warn('⚠️ IndexedDB: Database upgrade blocked by other tabs')
    })
  }

  /**
   * Check if IndexedDB is available and working
   */
  static isAvailable(): boolean {
    return indexedDBAvailable
  }

  /**
   * Get the last IndexedDB error
   */
  static getError(): Error | null {
    return indexedDBError
  }

  /**
   * Safe wrapper for database operations that handles DatabaseClosedError
   * Returns undefined/empty array on error instead of throwing
   */
  async safeOperation<T>(operation: () => Promise<T>, defaultValue: T): Promise<T> {
    if (!indexedDBAvailable) {
      return defaultValue
    }

    try {
      return await operation()
    } catch (error) {
      const errorName = (error as Error)?.name || ''
      const errorMessage = (error as Error)?.message || ''

      // Check for recoverable errors
      if (
        errorName === 'DatabaseClosedError' ||
        errorName === 'UnknownError' ||
        errorMessage.includes('Database has been closed') ||
        errorMessage.includes('backing store')
      ) {
        log.warn({ error }, '⚠️ IndexedDB: Database error, disabling IndexedDB for this session')
        indexedDBAvailable = false
        indexedDBError = error as Error

        // Try to delete the corrupted database for next session
        try {
          await Dexie.delete('AstridOfflineDB')
          log.info('🗑️ IndexedDB: Deleted corrupted database, will recreate on next page load')
        } catch (deleteError) {
          log.warn({ deleteError }, '⚠️ IndexedDB: Could not delete corrupted database')
        }
      }

      return defaultValue
    }
  }

  /**
   * Clear all offline data (useful for logout or force refresh)
   */
  async clearAll() {
    if (!indexedDBAvailable) {
      log.info('⚠️ IndexedDB: Skipping clear - database unavailable')
      return
    }

    try {
      await Promise.all([
        this.tasks.clear(),
        this.lists.clear(),
        this.users.clear(),
        this.publicTasks.clear(),
        this.comments.clear(),
        this.mutations.clear(),
        this.idMappings.clear(),
        this.listMembers.clear(),
        this.attachments.clear(),
        this.syncCursors.clear()
      ])
      if (process.env.NODE_ENV === 'development') {
        log.info('🗑️ IndexedDB: All data cleared')
      }
    } catch (error) {
      const errorName = (error as Error)?.name || ''
      const errorMessage = (error as Error)?.message || ''

      // Check if this is a database corruption error
      if (
        errorName === 'DatabaseClosedError' ||
        errorName === 'UnknownError' ||
        errorMessage.includes('Database has been closed') ||
        errorMessage.includes('backing store')
      ) {
        log.warn('⚠️ IndexedDB: Database corrupted, disabling for this session')
        indexedDBAvailable = false
        indexedDBError = error as Error
      }

      log.error({ err: error }, '❌ IndexedDB: Error clearing data')
      // If clearing fails, try to delete and recreate the database
      try {
        await Dexie.delete('AstridOfflineDB')
        if (process.env.NODE_ENV === 'development') {
          log.info('🗑️ IndexedDB: Database deleted and will be recreated')
        }
      } catch (deleteError) {
        log.error({ err: deleteError }, '❌ IndexedDB: Error deleting database')
        // Mark as unavailable to prevent further errors
        indexedDBAvailable = false
      }
    }
  }

  /**
   * Force refresh - clear all data and mark for immediate re-fetch
   * This should be called on page refresh or when user explicitly requests fresh data
   */
  async forceRefresh() {
    await this.clearAll()
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('indexeddb_force_refresh', Date.now().toString())
    }
  }

  /**
   * Get database size information
   */
  async getStorageInfo() {
    const [
      taskCount,
      listCount,
      userCount,
      publicTaskCount,
      commentCount,
      mutationCount,
      mappingCount,
      memberCount,
      attachmentCount,
      cursorCount
    ] = await Promise.all([
      this.tasks.count(),
      this.lists.count(),
      this.users.count(),
      this.publicTasks.count(),
      this.comments.count(),
      this.mutations.count(),
      this.idMappings.count(),
      this.listMembers.count(),
      this.attachments.count(),
      this.syncCursors.count()
    ])

    return {
      tasks: taskCount,
      lists: listCount,
      users: userCount,
      publicTasks: publicTaskCount,
      comments: commentCount,
      mutations: mutationCount,
      idMappings: mappingCount,
      listMembers: memberCount,
      attachments: attachmentCount,
      syncCursors: cursorCount,
      total: taskCount + listCount + userCount + publicTaskCount + commentCount +
             mutationCount + mappingCount + memberCount + attachmentCount + cursorCount
    }
  }
}

// Singleton instance
export const offlineDB = new OfflineDatabase()
