/**
 * Data Sync Orchestrator
 * Handles initial sync and incremental sync using cursors
 *
 * Sync Strategy:
 * 1. On app load: Check last sync time, perform incremental or full sync
 * 2. On reconnection: Perform incremental sync to catch up
 * 3. Periodic background sync: Every 5 minutes if app is active
 */

import { CacheManager } from './cache-manager'
import { fetchAllPages } from './api-paginate'
import {
  OfflineTaskOperations,
  OfflineListOperations,
  OfflineCommentOperations,
  OfflineSyncCursorOperations,
  type SyncCursor
} from './offline-db'
import { OfflineSyncManager } from './offline-sync'
import { CrossTabSync } from './cross-tab-sync'
import type { Task, TaskList, Comment } from '@/types/task'
import { safeResponseJson } from './safe-parse'
import { createLogger } from '@/lib/logger'

const log = createLogger('data-sync')


/**
 * Fetch with timeout to prevent hanging requests
 * Default timeout: 30 seconds
 */
async function fetchWithTimeout(
  url: string,
  options?: RequestInit & { timeout?: number }
): Promise<Response> {
  const { timeout = 30000, ...fetchOptions } = options || {}

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error'

export interface SyncResult {
  status: SyncStatus
  tasksUpdated: number
  listsUpdated: number
  commentsUpdated: number
  deletedIds: string[]
  error?: string
  duration: number
}

export interface SyncOptions {
  /** Force full sync even if cursors exist */
  forceFullSync?: boolean
  /** Only sync specific entity types */
  entities?: ('task' | 'list' | 'comment')[]
  /** Skip syncing pending mutations first */
  skipMutationSync?: boolean
}

/**
 * Data Sync Manager - Singleton
 */
class DataSyncManagerClass {
  private syncInProgress = false
  private lastSyncResult: SyncResult | null = null
  private syncListeners = new Set<(result: SyncResult) => void>()

  // Sync interval (5 minutes)
  private readonly SYNC_INTERVAL = 5 * 60 * 1000

  // Max age before forcing full sync (24 hours)
  private readonly MAX_CURSOR_AGE = 24 * 60 * 60 * 1000

  private syncIntervalId: ReturnType<typeof setInterval> | null = null
  private initialized = false

  // Store event listener references for cleanup
  private visibilityHandler: (() => void) | null = null
  private onlineHandler: (() => void) | null = null

  constructor() {
    if (typeof window !== 'undefined') {
      this.initialize()
    }
  }

  private initialize() {
    if (this.initialized) return
    this.initialized = true

    // Start periodic sync
    this.startPeriodicSync()

    // Sync on visibility change (tab becomes active)
    this.visibilityHandler = () => {
      if (!document.hidden && navigator.onLine) {
        this.performIncrementalSync().catch(err => log.error({ err }, 'performIncrementalSync failed'))
      }
    }
    document.addEventListener('visibilitychange', this.visibilityHandler)

    // Sync on reconnection
    this.onlineHandler = () => {
      if (process.env.NODE_ENV === 'development') {
        log.info('📡 [DataSync] Online - triggering sync')
      }
      this.performIncrementalSync().catch(err => log.error({ err }, 'performIncrementalSync failed'))
    }
    window.addEventListener('online', this.onlineHandler)
  }

  /**
   * Start periodic background sync
   */
  private startPeriodicSync() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId)
    }

    this.syncIntervalId = setInterval(() => {
      if (navigator.onLine && !document.hidden) {
        this.performIncrementalSync().catch(err => log.error({ err }, 'performIncrementalSync failed'))
      }
    }, this.SYNC_INTERVAL)
  }

  /**
   * Stop periodic sync
   */
  stopPeriodicSync() {
    if (this.syncIntervalId) {
      clearInterval(this.syncIntervalId)
      this.syncIntervalId = null
    }
  }

  /**
   * Full cleanup - removes all event listeners and intervals
   * Call this when unmounting the app or during cleanup
   */
  cleanup() {
    this.stopPeriodicSync()

    if (this.visibilityHandler) {
      document.removeEventListener('visibilitychange', this.visibilityHandler)
      this.visibilityHandler = null
    }

    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler)
      this.onlineHandler = null
    }

    this.syncListeners.clear()
    this.lastSyncResult = null
    this.initialized = false
  }

  /**
   * Perform initial sync (on app load)
   */
  async performInitialSync(options?: SyncOptions): Promise<SyncResult> {
    // Check if we have recent cursors
    const cursors = await OfflineSyncCursorOperations.getAllCursors()
    const hasRecentCursors = cursors.some(c =>
      Date.now() - c.lastSync < this.MAX_CURSOR_AGE
    )

    if (hasRecentCursors && !options?.forceFullSync) {
      // Perform incremental sync
      return this.performIncrementalSync(options)
    } else {
      // Perform full sync
      return this.performFullSync(options)
    }
  }

  /**
   * Perform full sync (fetch all data)
   */
  async performFullSync(options?: SyncOptions): Promise<SyncResult> {
    if (this.syncInProgress) {
      return {
        status: 'idle',
        tasksUpdated: 0,
        listsUpdated: 0,
        commentsUpdated: 0,
        deletedIds: [],
        duration: 0
      }
    }

    if (!navigator.onLine) {
      return {
        status: 'error',
        tasksUpdated: 0,
        listsUpdated: 0,
        commentsUpdated: 0,
        deletedIds: [],
        error: 'Offline',
        duration: 0
      }
    }

    this.syncInProgress = true
    const startTime = Date.now()

    try {
      if (process.env.NODE_ENV === 'development') {
        log.info('🔄 [DataSync] Starting full sync...')
      }

      // First, sync pending mutations
      if (!options?.skipMutationSync) {
        await OfflineSyncManager.syncPendingMutations()
      }

      const entities = options?.entities || ['task', 'list', 'comment']
      let tasksUpdated = 0
      let listsUpdated = 0
      let commentsUpdated = 0

      // Fetch lists
      if (entities.includes('list')) {
        const listsResponse = await fetchWithTimeout('/api/v1/lists', {
          credentials: 'include',
          timeout: 30000
        })

        if (listsResponse.ok) {
          const listsData = await listsResponse.json()
          const lists: TaskList[] = listsData.lists || listsData || []

          await CacheManager.setLists(lists, true)
          listsUpdated = lists.length

          // Update cursor
          await OfflineSyncCursorOperations.setCursor('list', new Date().toISOString())
        }
      }

      // Fetch tasks
      if (entities.includes('task')) {
        // v1 caps a page at 1000 rows; page through rather than taking the
        // first page as the whole answer (task 641a7615, decision 1B).
        const paged = await fetchAllPages<Task>('/api/v1/tasks', 'tasks', {
          init: { credentials: 'include' },
        })

        {
          const tasks: Task[] = paged.items
          if (paged.truncated) {
            console.warn('[DataSync] task page cap hit — cache may be incomplete')
          }

          await CacheManager.setTasks(tasks, true)
          tasksUpdated = tasks.length

          // Update cursor
          await OfflineSyncCursorOperations.setCursor('task', new Date().toISOString())
        }
      }

      const duration = Date.now() - startTime
      const result: SyncResult = {
        status: 'success',
        tasksUpdated,
        listsUpdated,
        commentsUpdated,
        deletedIds: [],
        duration
      }

      this.lastSyncResult = result
      this.notifyListeners(result)

      if (process.env.NODE_ENV === 'development') {
        log.info({ result }, `✅ [DataSync] Full sync complete in ${duration}ms:`)
      }

      return result
    } catch (error) {
      const duration = Date.now() - startTime
      const result: SyncResult = {
        status: 'error',
        tasksUpdated: 0,
        listsUpdated: 0,
        commentsUpdated: 0,
        deletedIds: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      }

      this.lastSyncResult = result
      this.notifyListeners(result)

      log.error({ err: error }, '❌ [DataSync] Full sync failed:')
      return result
    } finally {
      this.syncInProgress = false
    }
  }

  /**
   * Perform incremental sync (fetch only changes since last sync)
   */
  async performIncrementalSync(options?: SyncOptions): Promise<SyncResult> {
    if (this.syncInProgress) {
      return {
        status: 'idle',
        tasksUpdated: 0,
        listsUpdated: 0,
        commentsUpdated: 0,
        deletedIds: [],
        duration: 0
      }
    }

    if (!navigator.onLine) {
      return {
        status: 'error',
        tasksUpdated: 0,
        listsUpdated: 0,
        commentsUpdated: 0,
        deletedIds: [],
        error: 'Offline',
        duration: 0
      }
    }

    this.syncInProgress = true
    const startTime = Date.now()

    try {
      if (process.env.NODE_ENV === 'development') {
        log.info('🔄 [DataSync] Starting incremental sync...')
      }

      // First, sync pending mutations
      if (!options?.skipMutationSync) {
        await OfflineSyncManager.syncPendingMutations()
      }

      const entities = options?.entities || ['task', 'list', 'comment']
      let tasksUpdated = 0
      let listsUpdated = 0
      let commentsUpdated = 0
      const deletedIds: string[] = []

      // Get cursors
      const taskCursor = await OfflineSyncCursorOperations.getCursor('task')
      const listCursor = await OfflineSyncCursorOperations.getCursor('list')

      // Fetch lists incrementally
      if (entities.includes('list')) {
        const listSince = listCursor?.cursor || ''
        const url = listSince
          ? `/api/v1/lists?updatedSince=${encodeURIComponent(listSince)}`
          : '/api/v1/lists'

        const listsResponse = await fetchWithTimeout(url, {
          credentials: 'include',
          timeout: 30000
        })

        if (listsResponse.ok) {
          const listsData = await listsResponse.json()
          const lists: TaskList[] = listsData.lists || listsData || []
          const deleted: string[] = listsData.deletedIds || []

          // Update cache with new/updated lists
          for (const list of lists) {
            await CacheManager.setList(list, true)
          }
          listsUpdated = lists.length

          // Remove deleted lists
          for (const id of deleted) {
            await CacheManager.removeList(id, true)
            deletedIds.push(id)
          }

          // Update cursor
          await OfflineSyncCursorOperations.setCursor('list', new Date().toISOString())
        }
      }

      // Fetch tasks incrementally
      if (entities.includes('task')) {
        const taskSince = taskCursor?.cursor || ''
        const url = taskSince
          ? `/api/v1/tasks?updatedSince=${encodeURIComponent(taskSince)}`
          : '/api/v1/tasks'

        // deletedIds must be collected across pages too — losing them on page
        // two would resurrect deleted tasks in the local cache.
        const paged = await fetchAllPages<Task>(url, 'tasks', {
          init: { credentials: 'include' },
          alsoCollect: 'deletedIds',
        })

        {
          const tasks: Task[] = paged.items
          const deleted: string[] = paged.collected as string[]

          // Update cache with new/updated tasks
          for (const task of tasks) {
            await CacheManager.setTask(task, true)
          }
          tasksUpdated = tasks.length

          // Remove deleted tasks
          for (const id of deleted) {
            await CacheManager.removeTask(id, true)
            deletedIds.push(id)
          }

          // Update cursor
          await OfflineSyncCursorOperations.setCursor('task', new Date().toISOString())
        }
      }

      const duration = Date.now() - startTime
      const result: SyncResult = {
        status: 'success',
        tasksUpdated,
        listsUpdated,
        commentsUpdated,
        deletedIds,
        duration
      }

      this.lastSyncResult = result
      this.notifyListeners(result)

      if (process.env.NODE_ENV === 'development') {
        log.info({ result }, `✅ [DataSync] Incremental sync complete in ${duration}ms:`)
      }

      return result
    } catch (error) {
      const duration = Date.now() - startTime
      const result: SyncResult = {
        status: 'error',
        tasksUpdated: 0,
        listsUpdated: 0,
        commentsUpdated: 0,
        deletedIds: [],
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      }

      this.lastSyncResult = result
      this.notifyListeners(result)

      log.error({ err: error }, '❌ [DataSync] Incremental sync failed:')
      return result
    } finally {
      this.syncInProgress = false
    }
  }

  /**
   * Sync comments for a specific task
   */
  async syncTaskComments(taskId: string): Promise<Comment[]> {
    if (!navigator.onLine) {
      // Return cached comments
      const cached = await CacheManager.getCommentsByTask(taskId)
      return cached.data
    }

    try {
      const response = await fetchWithTimeout(`/api/tasks/${taskId}/comments`, {
        credentials: 'include',
        timeout: 30000
      })

      if (response.ok) {
        const data = await safeResponseJson<{ comments?: Comment[] } | Comment[]>(
          response,
          { comments: [] }
        )
        const comments: Comment[] = Array.isArray(data) ? data : (data.comments || [])

        // Cache comments
        for (const comment of comments) {
          await CacheManager.setComment(comment, true)
        }

        return comments
      }
    } catch (error) {
      log.error({ err: error }, `❌ [DataSync] Failed to sync comments for task ${taskId}:`)
    }

    // Return cached on error
    const cached = await CacheManager.getCommentsByTask(taskId)
    return cached.data
  }

  /**
   * Force clear all cursors (triggers full sync on next sync)
   */
  async resetSyncCursors(): Promise<void> {
    await OfflineSyncCursorOperations.clearAllCursors()
    CacheManager.clearAll()

    if (process.env.NODE_ENV === 'development') {
      log.info('🔄 [DataSync] Cursors reset - next sync will be full sync')
    }
  }

  /**
   * Subscribe to sync results
   */
  onSyncComplete(callback: (result: SyncResult) => void): () => void {
    this.syncListeners.add(callback)
    return () => this.syncListeners.delete(callback)
  }

  /**
   * Get last sync result
   */
  getLastSyncResult(): SyncResult | null {
    return this.lastSyncResult
  }

  /**
   * Check if sync is in progress
   */
  isSyncing(): boolean {
    return this.syncInProgress
  }

  /**
   * Get sync status
   */
  async getSyncStatus(): Promise<{
    isSyncing: boolean
    lastSync: SyncResult | null
    cursors: SyncCursor[]
    pendingMutations: number
  }> {
    const [cursors, mutationStats] = await Promise.all([
      OfflineSyncCursorOperations.getAllCursors(),
      OfflineSyncManager.getMutationStats()
    ])

    return {
      isSyncing: this.syncInProgress,
      lastSync: this.lastSyncResult,
      cursors,
      pendingMutations: mutationStats.pending
    }
  }

  private notifyListeners(result: SyncResult) {
    this.syncListeners.forEach(callback => {
      try {
        callback(result)
      } catch (error) {
        log.error({ err: error }, '❌ [DataSync] Error in sync listener:')
      }
    })
  }
}

// Singleton instance
export const DataSyncManager = new DataSyncManagerClass()

// Export default
export default DataSyncManager
