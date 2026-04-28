import { nanoid } from 'nanoid'
import { offlineDB, type MutationOperation, OfflineIdMappingOperations } from './offline-db'
import { apiCall } from './api'
import { CrossTabSync } from './cross-tab-sync'
import { safeResponseJson } from './safe-parse'
import { createLogger } from '@/lib/logger'

const log = createLogger('offline-sync')


/**
 * Mutation queue manager for offline operations
 * Handles queueing, syncing, and conflict resolution
 */
export class OfflineSyncManager {
  private static syncInProgress = false
  private static maxRetries = 3
  private static retryDelay = 1000 // 1 second base delay

  /**
   * Queue a mutation operation for offline sync
   */
  static async queueMutation(
    type: 'create' | 'update' | 'delete',
    entity: 'task' | 'list' | 'comment' | 'member' | 'attachment',
    entityId: string,
    endpoint: string,
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    data?: any,
    parentId?: string // For tracking relationships (e.g., comment's taskId)
  ): Promise<MutationOperation> {
    const mutation: MutationOperation = {
      id: nanoid(),
      type,
      entity,
      entityId,
      data,
      endpoint,
      method,
      timestamp: Date.now(),
      retryCount: 0,
      status: 'pending',
      parentId,
      tempId: entityId.startsWith('temp-') ? entityId : undefined
    }

    await offlineDB.mutations.add(mutation)

    if (process.env.NODE_ENV === 'development') {
      log.info({ mutation }, '📝 Queued offline mutation:')
    }

    // Broadcast to other tabs
    CrossTabSync.broadcastMutationQueued(entity, entityId, type, data)

    // Try to sync immediately if online
    if (navigator.onLine) {
      this.syncPendingMutations().catch(err => log.error({ err }, 'syncPendingMutations failed'))
    }

    return mutation
  }

  /**
   * Get all pending mutations
   */
  static async getPendingMutations(): Promise<MutationOperation[]> {
    return await offlineDB.mutations
      .where('status')
      .equals('pending')
      .sortBy('timestamp')
  }

  /**
   * Get mutations count by status
   */
  static async getMutationStats(): Promise<{
    pending: number
    failed: number
    completed: number
  }> {
    const [pending, failed, completed] = await Promise.all([
      offlineDB.mutations.where('status').equals('pending').count(),
      offlineDB.mutations.where('status').equals('failed').count(),
      offlineDB.mutations.where('status').equals('completed').count()
    ])

    return { pending, failed, completed }
  }

  /**
   * Sync all pending mutations with the server
   */
  static async syncPendingMutations(): Promise<{
    success: number
    failed: number
    errors: Array<{ mutation: MutationOperation; error: string }>
  }> {
    // Prevent concurrent sync operations
    if (this.syncInProgress) {
      if (process.env.NODE_ENV === 'development') {
        log.info('🔄 Sync already in progress, skipping')
      }
      return { success: 0, failed: 0, errors: [] }
    }

    // Check if online
    if (!navigator.onLine) {
      if (process.env.NODE_ENV === 'development') {
        log.info('📡 Offline, skipping sync')
      }
      return { success: 0, failed: 0, errors: [] }
    }

    this.syncInProgress = true

    // Broadcast sync started
    CrossTabSync.broadcastSyncStarted()

    try {
      const pendingMutations = await this.getPendingMutations()

      if (pendingMutations.length === 0) {
        if (process.env.NODE_ENV === 'development') {
          log.info('✅ No pending mutations to sync')
        }
        CrossTabSync.broadcastSyncCompleted(0, 0)
        return { success: 0, failed: 0, errors: [] }
      }

      if (process.env.NODE_ENV === 'development') {
        log.info(`🔄 Syncing ${pendingMutations.length} pending mutations...`)
      }

      let successCount = 0
      let failedCount = 0
      const errors: Array<{ mutation: MutationOperation; error: string }> = []

      // Process mutations in order, resolving dependencies
      for (const mutation of pendingMutations) {
        try {
          // Check if this mutation depends on a parent entity that has a temp ID
          let updatedMutation = mutation
          if (mutation.parentId?.startsWith('temp-')) {
            const realParentId = await OfflineIdMappingOperations.getRealId(mutation.parentId)
            if (realParentId) {
              // Update the mutation with real parent ID
              updatedMutation = { ...mutation }

              // Update endpoint if it contains the temp ID
              if (updatedMutation.endpoint.includes(mutation.parentId)) {
                updatedMutation.endpoint = updatedMutation.endpoint.replace(mutation.parentId, realParentId)
              }

              // Update data if it contains the parent reference
              if (updatedMutation.data?.taskId === mutation.parentId) {
                updatedMutation.data = { ...updatedMutation.data, taskId: realParentId }
              }
              if (updatedMutation.data?.listId === mutation.parentId) {
                updatedMutation.data = { ...updatedMutation.data, listId: realParentId }
              }

              if (process.env.NODE_ENV === 'development') {
                log.info(`🔗 Mapped temp parent ID ${mutation.parentId} → ${realParentId}`)
              }
            } else {
              // Parent hasn't synced yet, skip this mutation for now
              if (process.env.NODE_ENV === 'development') {
                log.info(`⏸️ Skipping mutation - waiting for parent ${mutation.parentId} to sync`)
              }
              continue
            }
          }

          const responseData = await this.processMutation(updatedMutation)
          successCount++

          // If this was a create operation with temp ID, save the ID mapping
          if (updatedMutation.type === 'create' && updatedMutation.tempId && responseData?.id) {
            await OfflineIdMappingOperations.saveMapping(updatedMutation.tempId, responseData.id, updatedMutation.entity)

            // ✅ FIX: Remove the temp entity from IndexedDB to prevent duplicates
            if (updatedMutation.entity === 'task') {
              const { OfflineTaskOperations } = await import('./offline-db')
              await OfflineTaskOperations.deleteTask(updatedMutation.tempId)
              if (process.env.NODE_ENV === 'development') {
                log.info(`🗑️ Removed temp task: ${updatedMutation.tempId}`)
              }
            } else if (updatedMutation.entity === 'list') {
              const { OfflineListOperations } = await import('./offline-db')
              await OfflineListOperations.deleteList(updatedMutation.tempId)
              if (process.env.NODE_ENV === 'development') {
                log.info(`🗑️ Removed temp list: ${updatedMutation.tempId}`)
              }
            }

            // Broadcast ID mapping to other tabs
            CrossTabSync.broadcastMutationSynced(
              updatedMutation.entity,
              responseData.id,
              updatedMutation.tempId,
              responseData.id
            )

            if (process.env.NODE_ENV === 'development') {
              log.info(`🔗 Saved ID mapping: ${updatedMutation.tempId} → ${responseData.id}`)
            }
          } else {
            // Broadcast synced without ID mapping
            CrossTabSync.broadcastMutationSynced(updatedMutation.entity, updatedMutation.entityId)
          }

          // Mark as completed and remove from queue
          await offlineDB.mutations.delete(mutation.id)

          if (process.env.NODE_ENV === 'development') {
            log.info({ mutationId: mutation.id, type: mutation.type, entity: mutation.entity }, '✅ Synced mutation')
          }
        } catch (error) {
          failedCount++
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          errors.push({ mutation, error: errorMessage })

          // Update retry count and status
          const updatedMutation: MutationOperation = {
            ...mutation,
            retryCount: mutation.retryCount + 1,
            lastError: errorMessage,
            status: mutation.retryCount + 1 >= this.maxRetries ? 'failed' : 'pending'
          }

          await offlineDB.mutations.put(updatedMutation)

          if (process.env.NODE_ENV === 'development') {
            log.error({ err: errorMessage }, `❌ Failed to sync mutation ${mutation.id}:`)
          }

          // If max retries reached, skip to next mutation
          if (mutation.retryCount + 1 >= this.maxRetries) {
            if (process.env.NODE_ENV === 'development') {
              log.error(`⚠️ Mutation ${mutation.id} exceeded max retries, marked as failed`)
            }
          }
        }

        // Small delay between mutations to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      if (process.env.NODE_ENV === 'development') {
        log.info(`🔄 Sync complete: ${successCount} success, ${failedCount} failed`)
      }

      // Broadcast sync completed
      CrossTabSync.broadcastSyncCompleted(successCount, failedCount)

      return { success: successCount, failed: failedCount, errors }
    } finally {
      this.syncInProgress = false
    }
  }

  /**
   * Process a single mutation operation with conflict detection
   * Returns the response data for ID mapping
   */
  private static async processMutation(mutation: MutationOperation): Promise<any> {
    const { endpoint, method, data, entity, entityId } = mutation

    try {
      // Use the clean API helpers from lib/api.ts
      const response = await apiCall(endpoint, {
        method,
        body: data ? JSON.stringify(data) : undefined
      })

      if (!response.ok) {
        // Handle specific HTTP errors
        if (response.status === 409) {
          // Conflict detected - server has newer version
          throw new Error('Conflict: Server has newer version of this resource')
        } else if (response.status === 404) {
          // Resource not found - may have been deleted on server
          throw new Error('Resource not found on server (may have been deleted)')
        } else if (response.status === 403) {
          // Permission denied
          throw new Error('Permission denied for this operation')
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Return the response data if needed
      const responseData = await safeResponseJson<any>(response, {})

      // Skip cache update if response is empty
      if (!responseData || Object.keys(responseData).length === 0) {
        log.warn('⚠️ [OfflineSync] Empty response data, skipping cache update')
        return
      }

      // Update local cache with server response to ensure consistency
      if (entity === 'task' && responseData.task) {
        const { OfflineTaskOperations } = await import('./offline-db')
        await OfflineTaskOperations.saveTask(responseData.task)
      } else if (entity === 'task' && responseData.id) {
        // Direct task response
        const { OfflineTaskOperations } = await import('./offline-db')
        await OfflineTaskOperations.saveTask(responseData)
      } else if (entity === 'list' && responseData.list) {
        const { OfflineListOperations } = await import('./offline-db')
        await OfflineListOperations.saveList(responseData.list)
      } else if (entity === 'list' && responseData.id) {
        // Direct list response
        const { OfflineListOperations } = await import('./offline-db')
        await OfflineListOperations.saveList(responseData)
      } else if (entity === 'comment' && responseData.id) {
        // Save comment to local cache
        const { OfflineCommentOperations } = await import('./offline-db')
        await OfflineCommentOperations.saveComment(responseData)
      }

      return responseData
    } catch (error) {
      // Enhanced error handling with conflict resolution hints
      if (error instanceof Error && error.message.includes('Conflict')) {
        // Log conflict for potential manual resolution
        if (process.env.NODE_ENV === 'development') {
          log.warn({
            entity,
            entityId,
            localData: data,
            error: error.message
          }, '⚠️ Conflict detected:')
        }

        // In production, you might want to:
        // 1. Fetch latest version from server
        // 2. Show conflict resolution UI to user
        // 3. Apply merge strategies (last-write-wins, manual merge, etc.)

        // For now, we'll throw and let retry logic handle it
      }

      throw error
    }
  }

  /**
   * Retry failed mutations
   */
  static async retryFailedMutations(): Promise<void> {
    const failedMutations = await offlineDB.mutations
      .where('status')
      .equals('failed')
      .toArray()

    if (failedMutations.length === 0) {
      return
    }

    if (process.env.NODE_ENV === 'development') {
      log.info(`🔄 Retrying ${failedMutations.length} failed mutations...`)
    }

    // Reset status to pending and retry count
    for (const mutation of failedMutations) {
      await offlineDB.mutations.put({
        ...mutation,
        status: 'pending',
        retryCount: 0,
        lastError: undefined
      })
    }

    // Trigger sync
    await this.syncPendingMutations()
  }

  /**
   * Clear completed mutations older than specified time
   */
  static async clearOldCompletedMutations(olderThanMs = 24 * 60 * 60 * 1000): Promise<void> {
    const cutoffTime = Date.now() - olderThanMs

    const oldMutations = await offlineDB.mutations
      .where('status')
      .equals('completed')
      .and(m => m.timestamp < cutoffTime)
      .toArray()

    if (oldMutations.length > 0) {
      const ids = oldMutations.map(m => m.id)
      await offlineDB.mutations.bulkDelete(ids)

      if (process.env.NODE_ENV === 'development') {
        log.info(`🗑️ Cleared ${oldMutations.length} old completed mutations`)
      }
    }
  }

  /**
   * Clear all mutations (useful for debugging or after successful sync)
   */
  static async clearAllMutations(): Promise<void> {
    await offlineDB.mutations.clear()

    if (process.env.NODE_ENV === 'development') {
      log.info('🗑️ Cleared all mutations')
    }
  }

  /**
   * Cancel a pending mutation
   */
  static async cancelMutation(mutationId: string): Promise<void> {
    await offlineDB.mutations.delete(mutationId)

    if (process.env.NODE_ENV === 'development') {
      log.info(`🗑️ Cancelled mutation ${mutationId}`)
    }
  }
}

/**
 * Helper to check if we should use offline mode
 */
export function isOfflineMode(): boolean {
  return typeof window !== 'undefined' && !navigator.onLine
}

/**
 * Helper to wait for online status
 */
export function waitForOnline(): Promise<void> {
  if (navigator.onLine) {
    return Promise.resolve()
  }

  return new Promise(resolve => {
    const handleOnline = () => {
      window.removeEventListener('online', handleOnline)
      resolve()
    }
    window.addEventListener('online', handleOnline)
  })
}

/**
 * Auto-sync manager for reconnection and cleanup
 * Stores references for proper cleanup
 */
class OfflineSyncAutoManager {
  private static onlineHandler: (() => void) | null = null
  private static cleanupIntervalId: ReturnType<typeof setInterval> | null = null
  private static initialized = false

  static initialize() {
    if (this.initialized || typeof window === 'undefined') return
    this.initialized = true

    // Auto-sync on reconnection
    this.onlineHandler = () => {
      if (process.env.NODE_ENV === 'development') {
        log.info('📡 Connection restored, syncing pending mutations...')
      }
      OfflineSyncManager.syncPendingMutations().catch(err => log.error({ err }, 'syncPendingMutations failed'))
    }
    window.addEventListener('online', this.onlineHandler)

    // Periodic cleanup of old completed mutations (every hour)
    this.cleanupIntervalId = setInterval(() => {
      OfflineSyncManager.clearOldCompletedMutations().catch(err => log.error({ err }, 'clearOldCompletedMutations failed'))
    }, 60 * 60 * 1000)
  }

  static cleanup() {
    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler)
      this.onlineHandler = null
    }

    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId)
      this.cleanupIntervalId = null
    }

    this.initialized = false
  }
}

// Auto-initialize
if (typeof window !== 'undefined') {
  OfflineSyncAutoManager.initialize()
}

// Export for cleanup
export { OfflineSyncAutoManager }
