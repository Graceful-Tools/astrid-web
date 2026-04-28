import Dexie, { Table } from 'dexie'
import type { Task, TaskList, Comment } from '@/types/task'
import { createLogger } from '@/lib/logger'

const log = createLogger('offline-db')


// Track if IndexedDB is available and working
let indexedDBAvailable = true
let indexedDBError: Error | null = null

/**
 * User interface for offline storage
 */
export interface OfflineUser {
  id: string
  name?: string
  email: string
  image?: string
}

/**
 * Mutation operation for offline sync queue
 */
export interface MutationOperation {
  id: string // Unique ID for the operation
  type: 'create' | 'update' | 'delete'
  entity: 'task' | 'list' | 'comment' | 'member' | 'attachment'
  entityId: string // ID of the entity being modified
  data: any // Data for create/update operations
  endpoint: string // API endpoint to call
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  timestamp: number
  retryCount: number
  lastError?: string
  status: 'pending' | 'failed' | 'completed'
  parentId?: string // For tracking relationships (e.g., comment's taskId)
  tempId?: string // Original temp ID before mapping to real ID
}

/**
 * List member for offline storage
 */
export interface OfflineListMember {
  id: string              // Composite: `${listId}_${userId}`
  listId: string
  userId: string
  role: 'owner' | 'admin' | 'member'
  joinedAt: string
  user?: OfflineUser      // Denormalized user data
  syncStatus: 'synced' | 'pending' | 'failed'
}

/**
 * Attachment for offline storage with blob support
 */
export interface OfflineAttachment {
  id: string
  taskId?: string
  commentId?: string
  name: string
  mimeType: string
  size: number
  url: string             // Original URL for re-download
  blob?: Blob             // Cached file data
  cachedAt: number
  accessedAt: number
  syncStatus: 'synced' | 'pending' | 'failed'
}

/**
 * Sync cursor for incremental sync
 */
export interface SyncCursor {
  entity: 'task' | 'list' | 'comment' | 'member'
  cursor: string          // ISO timestamp or opaque token
  lastSync: number
}

/**
 * ID mapping for temporary to real ID conversion
 */
export interface IdMapping {
  tempId: string
  realId: string
  entity: 'task' | 'list' | 'comment' | 'member' | 'attachment'
  timestamp: number
}

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

/**
 * User operations with offline support
 */
export class OfflineUserOperations {
  /**
   * Get all users
   */
  static async getUsers(): Promise<OfflineUser[]> {
    return await offlineDB.users.toArray()
  }

  /**
   * Get user by ID
   */
  static async getUser(id: string): Promise<OfflineUser | undefined> {
    return await offlineDB.users.get(id)
  }

  /**
   * Save user to offline storage
   */
  static async saveUser(user: OfflineUser): Promise<void> {
    await offlineDB.users.put(user)
  }

  /**
   * Save multiple users (bulk operation)
   */
  static async saveUsers(users: OfflineUser[]): Promise<void> {
    await offlineDB.users.bulkPut(users)
  }

  /**
   * Clear all users
   */
  static async clearUsers(): Promise<void> {
    await offlineDB.users.clear()
  }
}

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

/**
 * List member operations with offline support
 */
export class OfflineListMemberOperations {
  /**
   * Get all members for a list
   */
  static async getMembersByList(listId: string): Promise<OfflineListMember[]> {
    return await offlineDB.listMembers.where('listId').equals(listId).toArray()
  }

  /**
   * Get member by ID
   */
  static async getMember(id: string): Promise<OfflineListMember | undefined> {
    return await offlineDB.listMembers.get(id)
  }

  /**
   * Get member by list and user
   */
  static async getMemberByListAndUser(listId: string, userId: string): Promise<OfflineListMember | undefined> {
    const id = `${listId}_${userId}`
    return await offlineDB.listMembers.get(id)
  }

  /**
   * Save member to offline storage
   */
  static async saveMember(member: OfflineListMember): Promise<void> {
    await offlineDB.listMembers.put(member)
  }

  /**
   * Save multiple members (bulk operation)
   */
  static async saveMembers(members: OfflineListMember[]): Promise<void> {
    await offlineDB.listMembers.bulkPut(members)
  }

  /**
   * Delete member from offline storage
   */
  static async deleteMember(id: string): Promise<void> {
    await offlineDB.listMembers.delete(id)
  }

  /**
   * Delete all members for a list
   */
  static async deleteMembersByList(listId: string): Promise<void> {
    await offlineDB.listMembers.where('listId').equals(listId).delete()
  }

  /**
   * Get pending members (needs sync)
   */
  static async getPendingMembers(): Promise<OfflineListMember[]> {
    return await offlineDB.listMembers.where('syncStatus').equals('pending').toArray()
  }

  /**
   * Clear all members
   */
  static async clearMembers(): Promise<void> {
    await offlineDB.listMembers.clear()
  }
}

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
