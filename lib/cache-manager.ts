/**
 * Unified Cache Manager
 * Orchestrates three-tier cache: Memory -> IndexedDB -> Network
 *
 * Features:
 * - O(1) memory access for hot data
 * - IndexedDB persistence for offline support
 * - Automatic cache invalidation via SSE and cross-tab sync
 * - Stale-while-revalidate pattern
 */

import type { Task, TaskList, Comment } from '@/types/task'
import { MemoryCache, CollectionCache, CACHE_TTL, CACHE_SIZES } from './memory-cache'
import {
  offlineDB,
  OfflineTaskOperations,
  OfflineListOperations,
  OfflineCommentOperations,
  OfflineUserOperations,
  type OfflineUser
} from './offline-db'
import { CrossTabSync, type CrossTabEvent, type EntityType } from './cross-tab-sync'
import { createLogger } from '@/lib/logger'

const log = createLogger('cache-manager')


/**
 * Cache status for UI feedback
 */
export type CacheStatus = 'fresh' | 'stale' | 'loading' | 'error'

export interface CachedData<T> {
  data: T
  status: CacheStatus
  source: 'memory' | 'indexeddb' | 'network'
  cachedAt: number
  isStale: boolean
}

/**
 * Unified Cache Manager - Singleton
 */
class CacheManagerClass {
  // Entity caches (individual items)
  private taskCache: MemoryCache<Task>
  private listCache: MemoryCache<TaskList>
  private commentCache: MemoryCache<Comment>
  private userCache: MemoryCache<OfflineUser>

  // Collection caches (query results)
  private tasksByListCache: CollectionCache<Task>
  private commentsByTaskCache: CollectionCache<Comment>
  private userListsCache: CollectionCache<TaskList>
  private allTasksCache: CollectionCache<Task>

  // Track last sync time per entity type
  private lastSyncTime = new Map<EntityType, number>()

  // Subscribers for cache updates
  private updateListeners = new Map<string, Set<() => void>>()

  // Initialization flag
  private initialized = false

  // Cleanup interval ID
  private cleanupIntervalId: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Initialize entity caches
    this.taskCache = new MemoryCache<Task>({
      maxSize: CACHE_SIZES.TASKS,
      defaultTTL: CACHE_TTL.TASKS,
      name: 'TaskCache'
    })

    this.listCache = new MemoryCache<TaskList>({
      maxSize: CACHE_SIZES.LISTS,
      defaultTTL: CACHE_TTL.LISTS,
      name: 'ListCache'
    })

    this.commentCache = new MemoryCache<Comment>({
      maxSize: CACHE_SIZES.COMMENTS,
      defaultTTL: CACHE_TTL.COMMENTS,
      name: 'CommentCache'
    })

    this.userCache = new MemoryCache<OfflineUser>({
      maxSize: CACHE_SIZES.USERS,
      defaultTTL: CACHE_TTL.USERS,
      name: 'UserCache'
    })

    // Initialize collection caches
    this.tasksByListCache = new CollectionCache<Task>({
      maxSize: CACHE_SIZES.COLLECTIONS,
      defaultTTL: CACHE_TTL.TASKS,
      name: 'TasksByListCache'
    })

    this.commentsByTaskCache = new CollectionCache<Comment>({
      maxSize: CACHE_SIZES.COLLECTIONS,
      defaultTTL: CACHE_TTL.COMMENTS,
      name: 'CommentsByTaskCache'
    })

    this.userListsCache = new CollectionCache<TaskList>({
      maxSize: CACHE_SIZES.COLLECTIONS,
      defaultTTL: CACHE_TTL.LISTS,
      name: 'UserListsCache'
    })

    this.allTasksCache = new CollectionCache<Task>({
      maxSize: 1, // Only one "all tasks" collection
      defaultTTL: CACHE_TTL.TASKS,
      name: 'AllTasksCache'
    })

    // Initialize on client side
    if (typeof window !== 'undefined') {
      this.initialize()
    }
  }

  /**
   * Initialize cache manager
   */
  private initialize() {
    if (this.initialized) return

    // Subscribe to cross-tab events for cache invalidation
    CrossTabSync.subscribe(this.handleCrossTabEvent.bind(this))

    // Periodic cache cleanup (every 5 minutes)
    this.cleanupIntervalId = setInterval(() => {
      this.taskCache.cleanup()
      this.listCache.cleanup()
      this.commentCache.cleanup()
      this.userCache.cleanup()
    }, 5 * 60 * 1000)

    this.initialized = true

    if (process.env.NODE_ENV === 'development') {
      log.info('🗄️ [CacheManager] Initialized')
    }
  }

  /**
   * Cleanup resources (for testing/unmount)
   */
  cleanup(): void {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = null
    }
    this.clearAll()
    this.updateListeners.clear()
    this.initialized = false
  }

  /**
   * Handle cross-tab sync events
   */
  private handleCrossTabEvent(event: CrossTabEvent) {
    switch (event.type) {
      case 'cache_updated':
        // Another tab updated an entity - refresh from IndexedDB
        if (event.entity && event.entityId) {
          this.refreshFromIndexedDB(event.entity, event.entityId)
        }
        break

      case 'cache_invalidated':
        // Invalidate the specified cache
        if (event.entity) {
          this.invalidateEntity(event.entity, event.entityId)
        }
        break

      case 'entity_deleted':
        // Remove from all caches
        if (event.entity && event.entityId) {
          this.removeEntity(event.entity, event.entityId)
        }
        break

      case 'mutation_synced':
        // ID mapping changed - update caches with real ID
        if (event.data?.tempId && event.data?.realId && event.entity) {
          this.handleIdMapping(event.entity, event.data.tempId, event.data.realId)
        }
        break
    }
  }

  /**
   * Refresh entity from IndexedDB (after cross-tab update)
   */
  private async refreshFromIndexedDB(entity: EntityType, entityId: string) {
    try {
      switch (entity) {
        case 'task': {
          const task = await OfflineTaskOperations.getTask(entityId)
          if (task) {
            this.taskCache.set(entityId, task)
            this.notifyListeners(`task:${entityId}`)
          }
          break
        }
        case 'list': {
          const list = await OfflineListOperations.getList(entityId)
          if (list) {
            this.listCache.set(entityId, list)
            this.notifyListeners(`list:${entityId}`)
          }
          break
        }
        case 'comment': {
          const comment = await OfflineCommentOperations.getComment(entityId)
          if (comment) {
            this.commentCache.set(entityId, comment)
            this.notifyListeners(`comment:${entityId}`)
          }
          break
        }
      }
    } catch (error) {
      log.error({ err: error }, `❌ [CacheManager] Failed to refresh ${entity}:${entityId}:`)
    }
  }

  // ============================================
  // TASK OPERATIONS
  // ============================================

  /**
   * Get task (checks memory -> IndexedDB)
   */
  async getTask(taskId: string): Promise<CachedData<Task> | null> {
    // Check memory cache first
    const memoryTask = this.taskCache.get(taskId)
    if (memoryTask) {
      return {
        data: memoryTask,
        status: 'fresh',
        source: 'memory',
        cachedAt: Date.now(),
        isStale: false
      }
    }

    // Check IndexedDB
    try {
      const dbTask = await OfflineTaskOperations.getTask(taskId)
      if (dbTask) {
        // Populate memory cache
        this.taskCache.set(taskId, dbTask)

        return {
          data: dbTask,
          status: 'fresh',
          source: 'indexeddb',
          cachedAt: Date.now(),
          isStale: false
        }
      }
    } catch (error) {
      log.error({ err: error }, `❌ [CacheManager] Failed to get task ${taskId}:`)
    }

    return null
  }

  /**
   * Get all tasks (checks memory -> IndexedDB)
   */
  async getAllTasks(): Promise<CachedData<Task[]>> {
    // Check collection cache first
    const cached = this.allTasksCache.get('all')
    if (cached) {
      return {
        data: cached,
        status: 'fresh',
        source: 'memory',
        cachedAt: Date.now(),
        isStale: false
      }
    }

    // Get from IndexedDB
    try {
      const tasks = await OfflineTaskOperations.getTasks()

      // Populate caches
      this.allTasksCache.set('all', tasks)
      for (const task of tasks) {
        this.taskCache.set(task.id, task)
      }

      return {
        data: tasks,
        status: 'fresh',
        source: 'indexeddb',
        cachedAt: Date.now(),
        isStale: false
      }
    } catch (error) {
      log.error({ err: error }, '❌ [CacheManager] Failed to get all tasks:')
      return {
        data: [],
        status: 'error',
        source: 'indexeddb',
        cachedAt: Date.now(),
        isStale: true
      }
    }
  }

  /**
   * Get tasks by list ID
   */
  async getTasksByList(listId: string): Promise<CachedData<Task[]>> {
    // Check collection cache
    const cached = this.tasksByListCache.get(listId)
    if (cached) {
      return {
        data: cached,
        status: 'fresh',
        source: 'memory',
        cachedAt: Date.now(),
        isStale: false
      }
    }

    // Get from IndexedDB
    try {
      const tasks = await OfflineTaskOperations.getTasksByList(listId)

      // Populate caches
      this.tasksByListCache.set(listId, tasks)
      for (const task of tasks) {
        this.taskCache.set(task.id, task)
      }

      return {
        data: tasks,
        status: 'fresh',
        source: 'indexeddb',
        cachedAt: Date.now(),
        isStale: false
      }
    } catch (error) {
      log.error({ err: error }, `❌ [CacheManager] Failed to get tasks for list ${listId}:`)
      return {
        data: [],
        status: 'error',
        source: 'indexeddb',
        cachedAt: Date.now(),
        isStale: true
      }
    }
  }

  /**
   * Set task in all caches
   */
  async setTask(task: Task, persistToIndexedDB = true, skipCrossTabSync = false): Promise<void> {
    // Update memory cache
    this.taskCache.set(task.id, task)

    // Update collection caches
    this.allTasksCache.updateInCollection('all', task.id, () => task, t => t.id)

    // Update list-specific cache if task has lists
    if (task.lists) {
      for (const list of task.lists) {
        this.tasksByListCache.updateInCollection(list.id, task.id, () => task, t => t.id)
      }
    }

    // Persist to IndexedDB (with graceful error handling)
    if (persistToIndexedDB) {
      try {
        await OfflineTaskOperations.saveTask(task)
      } catch (error) {
        // Log but don't fail - memory cache is still updated
        log.error({ err: error }, '❌ [CacheManager] Failed to persist task to IndexedDB:')
      }
    }

    // Broadcast to other tabs (skip when update came from SSE, since all tabs get SSE independently)
    if (!skipCrossTabSync) {
      CrossTabSync.broadcastCacheUpdated('task', task.id)
    }

    // Notify listeners
    this.notifyListeners(`task:${task.id}`)
    this.notifyListeners('tasks')
  }

  /**
   * Set multiple tasks
   */
  async setTasks(tasks: Task[], persistToIndexedDB = true): Promise<void> {
    // Update memory caches
    for (const task of tasks) {
      this.taskCache.set(task.id, task)
    }

    // Update all tasks collection
    this.allTasksCache.set('all', tasks)

    // Persist to IndexedDB (with graceful error handling)
    if (persistToIndexedDB) {
      try {
        await OfflineTaskOperations.saveTasks(tasks)
      } catch (error) {
        // Log but don't fail - memory cache is still updated
        log.error({ err: error }, '❌ [CacheManager] Failed to persist tasks to IndexedDB:')
      }
    }

    // Notify listeners
    this.notifyListeners('tasks')
  }

  /**
   * Remove task from all caches
   */
  async removeTask(taskId: string, persistToIndexedDB = true): Promise<void> {
    // Get task first to know which list caches to update
    const task = this.taskCache.get(taskId)

    // Remove from memory cache
    this.taskCache.delete(taskId)

    // Remove from collection caches
    this.allTasksCache.removeFromCollection('all', taskId, t => t.id)

    if (task?.lists) {
      for (const list of task.lists) {
        this.tasksByListCache.removeFromCollection(list.id, taskId, t => t.id)
      }
    }

    // Remove from IndexedDB (with graceful error handling)
    if (persistToIndexedDB) {
      try {
        await OfflineTaskOperations.deleteTask(taskId)
      } catch (error) {
        log.error({ err: error }, '❌ [CacheManager] Failed to delete task from IndexedDB:')
      }
    }

    // Broadcast to other tabs
    CrossTabSync.broadcastEntityDeleted('task', taskId)

    // Notify listeners
    this.notifyListeners(`task:${taskId}`)
    this.notifyListeners('tasks')
  }

  // ============================================
  // LIST OPERATIONS
  // ============================================

  /**
   * Get list by ID
   */
  async getList(listId: string): Promise<CachedData<TaskList> | null> {
    // Check memory cache
    const memoryList = this.listCache.get(listId)
    if (memoryList) {
      return {
        data: memoryList,
        status: 'fresh',
        source: 'memory',
        cachedAt: Date.now(),
        isStale: false
      }
    }

    // Check IndexedDB
    try {
      const dbList = await OfflineListOperations.getList(listId)
      if (dbList) {
        this.listCache.set(listId, dbList)
        return {
          data: dbList,
          status: 'fresh',
          source: 'indexeddb',
          cachedAt: Date.now(),
          isStale: false
        }
      }
    } catch (error) {
      log.error({ err: error }, `❌ [CacheManager] Failed to get list ${listId}:`)
    }

    return null
  }

  /**
   * Get all lists for a user
   */
  async getAllLists(userId?: string): Promise<CachedData<TaskList[]>> {
    const cacheKey = userId || 'all'

    // Check collection cache
    const cached = this.userListsCache.get(cacheKey)
    if (cached) {
      return {
        data: cached,
        status: 'fresh',
        source: 'memory',
        cachedAt: Date.now(),
        isStale: false
      }
    }

    // Get from IndexedDB
    try {
      const lists = await OfflineListOperations.getLists()

      // Populate caches
      this.userListsCache.set(cacheKey, lists)
      for (const list of lists) {
        this.listCache.set(list.id, list)
      }

      return {
        data: lists,
        status: 'fresh',
        source: 'indexeddb',
        cachedAt: Date.now(),
        isStale: false
      }
    } catch (error) {
      log.error({ err: error }, '❌ [CacheManager] Failed to get all lists:')
      return {
        data: [],
        status: 'error',
        source: 'indexeddb',
        cachedAt: Date.now(),
        isStale: true
      }
    }
  }

  /**
   * Set list in all caches
   */
  async setList(list: TaskList, persistToIndexedDB = true, skipCrossTabSync = false): Promise<void> {
    this.listCache.set(list.id, list)

    // Update user lists collection
    this.userListsCache.updateInCollection('all', list.id, () => list, l => l.id)

    if (persistToIndexedDB) {
      try {
        await OfflineListOperations.saveList(list)
      } catch (error) {
        log.error({ err: error }, '❌ [CacheManager] Failed to persist list to IndexedDB:')
      }
    }

    if (!skipCrossTabSync) {
      CrossTabSync.broadcastCacheUpdated('list', list.id)
    }
    this.notifyListeners(`list:${list.id}`)
    this.notifyListeners('lists')
  }

  /**
   * Set multiple lists
   */
  async setLists(lists: TaskList[], persistToIndexedDB = true): Promise<void> {
    for (const list of lists) {
      this.listCache.set(list.id, list)
    }

    this.userListsCache.set('all', lists)

    if (persistToIndexedDB) {
      try {
        await OfflineListOperations.saveLists(lists)
      } catch (error) {
        log.error({ err: error }, '❌ [CacheManager] Failed to persist lists to IndexedDB:')
      }
    }

    this.notifyListeners('lists')
  }

  /**
   * Remove list from all caches
   */
  async removeList(listId: string, persistToIndexedDB = true): Promise<void> {
    this.listCache.delete(listId)
    this.userListsCache.removeFromCollection('all', listId, l => l.id)
    this.tasksByListCache.delete(listId)

    if (persistToIndexedDB) {
      try {
        await OfflineListOperations.deleteList(listId)
      } catch (error) {
        log.error({ err: error }, '❌ [CacheManager] Failed to delete list from IndexedDB:')
      }
    }

    CrossTabSync.broadcastEntityDeleted('list', listId)
    this.notifyListeners(`list:${listId}`)
    this.notifyListeners('lists')
  }

  // ============================================
  // COMMENT OPERATIONS
  // ============================================

  /**
   * Get comments by task ID
   */
  async getCommentsByTask(taskId: string): Promise<CachedData<Comment[]>> {
    // Check collection cache
    const cached = this.commentsByTaskCache.get(taskId)
    if (cached) {
      return {
        data: cached,
        status: 'fresh',
        source: 'memory',
        cachedAt: Date.now(),
        isStale: false
      }
    }

    // Get from IndexedDB
    try {
      const comments = await OfflineCommentOperations.getCommentsByTask(taskId)

      // Populate caches
      this.commentsByTaskCache.set(taskId, comments)
      for (const comment of comments) {
        this.commentCache.set(comment.id, comment)
      }

      return {
        data: comments,
        status: 'fresh',
        source: 'indexeddb',
        cachedAt: Date.now(),
        isStale: false
      }
    } catch (error) {
      log.error({ err: error }, `❌ [CacheManager] Failed to get comments for task ${taskId}:`)
      return {
        data: [],
        status: 'error',
        source: 'indexeddb',
        cachedAt: Date.now(),
        isStale: true
      }
    }
  }

  /**
   * Set comment in all caches
   */
  async setComment(comment: Comment, persistToIndexedDB = true, skipCrossTabSync = false): Promise<void> {
    this.commentCache.set(comment.id, comment)

    // Update task's comment collection
    this.commentsByTaskCache.addToCollection(comment.taskId, comment, c => c.id)

    if (persistToIndexedDB) {
      try {
        await OfflineCommentOperations.saveComment(comment)
      } catch (error) {
        log.error({ err: error }, '❌ [CacheManager] Failed to persist comment to IndexedDB:')
      }
    }

    if (!skipCrossTabSync) {
      CrossTabSync.broadcastCacheUpdated('comment', comment.id)
    }
    this.notifyListeners(`comment:${comment.id}`)
    this.notifyListeners(`comments:${comment.taskId}`)
  }

  /**
   * Remove comment from all caches
   */
  async removeComment(commentId: string, taskId: string, persistToIndexedDB = true): Promise<void> {
    this.commentCache.delete(commentId)
    this.commentsByTaskCache.removeFromCollection(taskId, commentId, c => c.id)

    if (persistToIndexedDB) {
      try {
        await OfflineCommentOperations.deleteComment(commentId)
      } catch (error) {
        log.error({ err: error }, '❌ [CacheManager] Failed to delete comment from IndexedDB:')
      }
    }

    CrossTabSync.broadcastEntityDeleted('comment', commentId)
    this.notifyListeners(`comment:${commentId}`)
    this.notifyListeners(`comments:${taskId}`)
  }

  // ============================================
  // USER OPERATIONS
  // ============================================

  /**
   * Get user by ID
   */
  async getUser(userId: string): Promise<OfflineUser | null> {
    // Check memory cache
    const memoryUser = this.userCache.get(userId)
    if (memoryUser) {
      return memoryUser
    }

    // Check IndexedDB
    try {
      const dbUser = await OfflineUserOperations.getUser(userId)
      if (dbUser) {
        this.userCache.set(userId, dbUser)
        return dbUser
      }
    } catch (error) {
      log.error({ err: error }, `❌ [CacheManager] Failed to get user ${userId}:`)
    }

    return null
  }

  /**
   * Set user in cache
   */
  async setUser(user: OfflineUser, persistToIndexedDB = true): Promise<void> {
    this.userCache.set(user.id, user)

    if (persistToIndexedDB) {
      try {
        await OfflineUserOperations.saveUser(user)
      } catch (error) {
        log.error({ err: error }, '❌ [CacheManager] Failed to persist user to IndexedDB:')
      }
    }
  }

  // ============================================
  // INVALIDATION & UTILITIES
  // ============================================

  /**
   * Invalidate entity in memory cache
   */
  invalidateEntity(entity: EntityType, entityId?: string): void {
    switch (entity) {
      case 'task':
        if (entityId) {
          this.taskCache.invalidate(entityId)
        } else {
          this.taskCache.invalidateAll()
          this.allTasksCache.invalidateAll()
          this.tasksByListCache.invalidateAll()
        }
        break

      case 'list':
        if (entityId) {
          this.listCache.invalidate(entityId)
        } else {
          this.listCache.invalidateAll()
          this.userListsCache.invalidateAll()
        }
        break

      case 'comment':
        if (entityId) {
          this.commentCache.invalidate(entityId)
        } else {
          this.commentCache.invalidateAll()
          this.commentsByTaskCache.invalidateAll()
        }
        break
    }
  }

  /**
   * Remove entity from all caches
   */
  removeEntity(entity: EntityType, entityId: string): void {
    switch (entity) {
      case 'task':
        this.taskCache.delete(entityId)
        this.allTasksCache.removeFromCollection('all', entityId, t => t.id)
        break

      case 'list':
        this.listCache.delete(entityId)
        this.userListsCache.removeFromCollection('all', entityId, l => l.id)
        this.tasksByListCache.delete(entityId)
        break

      case 'comment':
        this.commentCache.delete(entityId)
        // Note: Can't remove from commentsByTaskCache without knowing taskId
        break
    }
  }

  /**
   * Handle temp ID to real ID mapping
   */
  private handleIdMapping(entity: EntityType, tempId: string, realId: string): void {
    switch (entity) {
      case 'task': {
        const task = this.taskCache.get(tempId)
        if (task) {
          this.taskCache.delete(tempId)
          this.taskCache.set(realId, { ...task, id: realId })
        }
        break
      }

      case 'list': {
        const list = this.listCache.get(tempId)
        if (list) {
          this.listCache.delete(tempId)
          this.listCache.set(realId, { ...list, id: realId })
        }
        break
      }

      case 'comment': {
        const comment = this.commentCache.get(tempId)
        if (comment) {
          this.commentCache.delete(tempId)
          this.commentCache.set(realId, { ...comment, id: realId })
        }
        break
      }
    }
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.taskCache.clear()
    this.listCache.clear()
    this.commentCache.clear()
    this.userCache.clear()
    this.allTasksCache.clear()
    this.tasksByListCache.clear()
    this.commentsByTaskCache.clear()
    this.userListsCache.clear()
    this.lastSyncTime.clear()

    if (process.env.NODE_ENV === 'development') {
      log.info('🗑️ [CacheManager] All caches cleared')
    }
  }

  /**
   * Subscribe to cache updates
   */
  subscribe(key: string, callback: () => void): () => void {
    if (!this.updateListeners.has(key)) {
      this.updateListeners.set(key, new Set())
    }

    this.updateListeners.get(key)!.add(callback)

    return () => {
      this.updateListeners.get(key)?.delete(callback)
    }
  }

  /**
   * Notify listeners of cache update
   */
  private notifyListeners(key: string): void {
    this.updateListeners.get(key)?.forEach(callback => {
      try {
        callback()
      } catch (error) {
        log.error({ err: error }, '❌ [CacheManager] Error in listener callback:')
      }
    })
  }

  /**
   * Get cache stats for debugging
   */
  getStats() {
    return {
      tasks: this.taskCache.getStats(),
      lists: this.listCache.getStats(),
      comments: this.commentCache.getStats(),
      users: this.userCache.getStats(),
      collections: {
        allTasks: this.allTasksCache.getStats(),
        tasksByList: this.tasksByListCache.getStats(),
        commentsByTask: this.commentsByTaskCache.getStats(),
        userLists: this.userListsCache.getStats()
      },
      lastSyncTime: Object.fromEntries(this.lastSyncTime)
    }
  }

  /**
   * Set last sync time for an entity type
   */
  setLastSyncTime(entity: EntityType, time = Date.now()): void {
    this.lastSyncTime.set(entity, time)
  }

  /**
   * Get last sync time for an entity type
   */
  getLastSyncTime(entity: EntityType): number | undefined {
    return this.lastSyncTime.get(entity)
  }
}

// Singleton instance
export const CacheManager = new CacheManagerClass()

// Export default
export default CacheManager
