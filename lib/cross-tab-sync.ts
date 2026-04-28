import { createLogger } from '@/lib/logger'

const log = createLogger('cross-tab-sync')

/**
 * Cross-Tab Synchronization Manager
 * Uses BroadcastChannel API to sync state across browser tabs
 *
 * Events broadcast:
 * - mutation_queued: New offline mutation added
 * - mutation_synced: Mutation completed with ID mapping
 * - cache_updated: IndexedDB data changed (task/list/comment)
 * - cache_invalidated: Cache should be refreshed
 * - sync_started: Sync operation started
 * - sync_completed: Sync operation finished
 */

export type CrossTabEventType =
  | 'mutation_queued'
  | 'mutation_synced'
  | 'cache_updated'
  | 'cache_invalidated'
  | 'sync_started'
  | 'sync_completed'
  | 'entity_deleted'

export type EntityType = 'task' | 'list' | 'comment' | 'member' | 'attachment'

export interface CrossTabEvent {
  type: CrossTabEventType
  entity?: EntityType
  entityId?: string
  data?: any
  timestamp: number
  tabId: string // Originating tab ID
}

export type CrossTabEventCallback = (event: CrossTabEvent) => void

/**
 * Generate unique tab ID for this browser tab
 */
function generateTabId(): string {
  if (typeof window === 'undefined') return 'server'

  // Try to get existing tab ID from sessionStorage (persists across refreshes in same tab)
  let tabId = sessionStorage.getItem('astrid_tab_id')
  if (!tabId) {
    tabId = `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    sessionStorage.setItem('astrid_tab_id', tabId)
  }
  return tabId
}

/**
 * Cross-Tab Sync Manager - Singleton
 * Manages BroadcastChannel communication between browser tabs
 */
class CrossTabSyncManagerClass {
  private channel: BroadcastChannel | null = null
  private tabId: string
  private subscribers = new Map<string, CrossTabEventCallback>()
  private isSupported: boolean

  // Track if we've initialized
  private initialized = false

  constructor() {
    this.tabId = generateTabId()
    this.isSupported = typeof BroadcastChannel !== 'undefined'

    if (typeof window !== 'undefined') {
      this.initialize()
    }
  }

  /**
   * Initialize the BroadcastChannel
   */
  private initialize() {
    if (this.initialized || !this.isSupported) return

    try {
      this.channel = new BroadcastChannel('astrid-sync-channel')
      this.channel.onmessage = this.handleMessage.bind(this)
      this.channel.onmessageerror = this.handleMessageError.bind(this)

      this.initialized = true

      if (process.env.NODE_ENV === 'development') {
        log.info(`🔗 [CrossTabSync] Initialized for tab ${this.tabId}`)
      }
    } catch (error) {
      log.error({ err: error }, '❌ [CrossTabSync] Failed to initialize BroadcastChannel:')
      this.isSupported = false
    }
  }

  /**
   * Handle incoming messages from other tabs
   */
  private handleMessage(event: MessageEvent<CrossTabEvent>) {
    const crossTabEvent = event.data

    // Ignore messages from this tab
    if (crossTabEvent.tabId === this.tabId) {
      return
    }

    if (process.env.NODE_ENV === 'development') {
      log.info({ type: crossTabEvent.type, entity: crossTabEvent.entity || '', tabId: crossTabEvent.tabId }, '📨 [CrossTabSync] Received')
    }

    // Notify all subscribers
    this.subscribers.forEach(callback => {
      try {
        callback(crossTabEvent)
      } catch (error) {
        log.error({ err: error }, '❌ [CrossTabSync] Error in subscriber callback:')
      }
    })
  }

  /**
   * Handle message errors
   */
  private handleMessageError(event: MessageEvent) {
    log.error({ err: event }, '❌ [CrossTabSync] Message error:')
  }

  /**
   * Subscribe to cross-tab events
   * Returns unsubscribe function
   */
  subscribe(callback: CrossTabEventCallback): () => void {
    const id = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    this.subscribers.set(id, callback)

    return () => {
      this.subscribers.delete(id)
    }
  }

  /**
   * Subscribe to specific event types
   * Returns unsubscribe function
   */
  subscribeToEvents(
    eventTypes: CrossTabEventType[],
    callback: CrossTabEventCallback
  ): () => void {
    return this.subscribe((event) => {
      if (eventTypes.includes(event.type)) {
        callback(event)
      }
    })
  }

  /**
   * Broadcast event to all other tabs
   */
  broadcast(
    type: CrossTabEventType,
    options?: {
      entity?: EntityType
      entityId?: string
      data?: any
    }
  ): void {
    if (!this.isSupported || !this.channel) {
      return
    }

    const event: CrossTabEvent = {
      type,
      entity: options?.entity,
      entityId: options?.entityId,
      data: options?.data,
      timestamp: Date.now(),
      tabId: this.tabId
    }

    try {
      this.channel.postMessage(event)

      if (process.env.NODE_ENV === 'development') {
        log.info({ type, entity: options?.entity || '', entityId: options?.entityId || '' }, '📤 [CrossTabSync] Broadcast')
      }
    } catch (error) {
      log.error({ err: error }, '❌ [CrossTabSync] Failed to broadcast:')
    }
  }

  /**
   * Broadcast mutation queued event
   */
  broadcastMutationQueued(
    entity: EntityType,
    entityId: string,
    mutationType: 'create' | 'update' | 'delete',
    data?: any
  ): void {
    this.broadcast('mutation_queued', {
      entity,
      entityId,
      data: { mutationType, ...data }
    })
  }

  /**
   * Broadcast mutation synced event (includes ID mapping for creates)
   */
  broadcastMutationSynced(
    entity: EntityType,
    entityId: string,
    tempId?: string,
    realId?: string
  ): void {
    this.broadcast('mutation_synced', {
      entity,
      entityId,
      data: tempId && realId ? { tempId, realId } : undefined
    })
  }

  /**
   * Broadcast cache update event (entity was added/updated in IndexedDB)
   */
  broadcastCacheUpdated(
    entity: EntityType,
    entityId: string,
    data?: any
  ): void {
    this.broadcast('cache_updated', {
      entity,
      entityId,
      data
    })
  }

  /**
   * Broadcast cache invalidation (entity should be refreshed from server)
   */
  broadcastCacheInvalidated(entity: EntityType, entityId?: string): void {
    this.broadcast('cache_invalidated', {
      entity,
      entityId
    })
  }

  /**
   * Broadcast entity deletion
   */
  broadcastEntityDeleted(entity: EntityType, entityId: string): void {
    this.broadcast('entity_deleted', {
      entity,
      entityId
    })
  }

  /**
   * Broadcast sync status changes
   */
  broadcastSyncStarted(): void {
    this.broadcast('sync_started')
  }

  broadcastSyncCompleted(success: number, failed: number): void {
    this.broadcast('sync_completed', {
      data: { success, failed }
    })
  }

  /**
   * Get current tab ID
   */
  getTabId(): string {
    return this.tabId
  }

  /**
   * Check if BroadcastChannel is supported
   */
  isBroadcastSupported(): boolean {
    return this.isSupported
  }

  /**
   * Close the channel (cleanup)
   */
  close(): void {
    if (this.channel) {
      this.channel.close()
      this.channel = null
      this.initialized = false
    }
    this.subscribers.clear()
  }
}

// Singleton instance
export const CrossTabSync = new CrossTabSyncManagerClass()

// Export default
export default CrossTabSync
