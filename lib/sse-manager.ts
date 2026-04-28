"use client"

import { getSession } from "next-auth/react"
import { safeEventParse } from "./safe-parse"
import { createLogger } from '@/lib/logger'

const log = createLogger('sse-manager')


export interface SSEEvent {
  type: string
  timestamp: string
  data?: any
}

export interface SSESubscription {
  id: string
  eventTypes: string[]
  callback: (event: SSEEvent) => void
  component?: string // For debugging
}

/**
 * Centralized SSE Manager - Singleton pattern
 * Manages single SSE connection and routes events to all subscribers
 */
class SSEManagerClass {
  private eventSource: EventSource | null = null
  private subscriptions = new Map<string, SSESubscription>()
  private isConnected = false
  private isConnecting = false
  private reconnectTimeout: NodeJS.Timeout | null = null
  private heartbeatTimeout: NodeJS.Timeout | null = null
  private connectionAttempts = 0
  private lastEventTime = Date.now()

  // Connection state change listeners
  private connectionListeners = new Set<(connected: boolean) => void>()

  // Reconnection listeners - called when connection is re-established after disconnect
  private reconnectionListeners = new Set<() => void>()

  // Track previous connection state to detect reconnections
  private wasDisconnected = false

  // Flag to indicate we're in a graceful reconnect (don't count as error)
  private isGracefulReconnect = false

  constructor() {
    if (typeof window !== 'undefined') {
      // Handle page visibility for reconnection
      document.addEventListener('visibilitychange', this.handleVisibilityChange.bind(this))
    }
  }

  /**
   * Subscribe to SSE events
   * Returns unsubscribe function
   */
  subscribe(
    eventTypes: string | string[] | readonly string[],
    callback: (event: SSEEvent) => void,
    componentName?: string
  ): () => void {
    const id = `${componentName || 'unknown'}_${Date.now()}_${Math.random()}`
    const types: string[] = Array.isArray(eventTypes) ? [...eventTypes] as string[] : [eventTypes as string]

    this.subscriptions.set(id, {
      id,
      eventTypes: types,
      callback,
      component: componentName
    })

    // Auto-connect if not already connected
    if (!this.isConnected && !this.isConnecting) {
      this.connect()
    }

    // Return unsubscribe function
    return () => {
      // Debug: Unsubscribing from SSE events
      this.subscriptions.delete(id)

      // Disconnect if no more subscriptions
      if (this.subscriptions.size === 0) {
        this.disconnect()
      }
    }
  }

  /**
   * Subscribe to connection state changes
   */
  onConnectionChange(callback: (connected: boolean) => void): () => void {
    this.connectionListeners.add(callback)

    // Call immediately with current state
    callback(this.isConnected)

    return () => {
      this.connectionListeners.delete(callback)
    }
  }

  /**
   * Subscribe to reconnection events (called when connection is re-established after disconnect)
   */
  onReconnection(callback: () => void): () => void {
    this.reconnectionListeners.add(callback)

    return () => {
      this.reconnectionListeners.delete(callback)
    }
  }

  /**
   * Get current connection status
   */
  getConnectionStatus() {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      connectionAttempts: this.connectionAttempts,
      subscriptionCount: this.subscriptions.size,
      lastEventTime: this.lastEventTime
    }
  }

  /**
   * Establish SSE connection
   */
  private async connect() {
    if (this.isConnecting || this.isConnected) {
      return
    }

    // Check if user is authenticated - with error handling
    let session
    try {
      session = await getSession()
    } catch (error) {
      log.warn({ error }, '🔗 [SSE Manager] Failed to get session, retrying in 2s:')
      // Retry session fetch after a short delay
      setTimeout(() => this.connect(), 2000)
      return
    }

    if (!session?.user) {
      // Only log in development - this is expected for logged-out users
      if (process.env.NODE_ENV === 'development') {
        log.info('🔗 [SSEManager] No session/user, skipping SSE connection')
      }
      return
    }

    this.isConnecting = true

    // Close existing connection if any
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    try {
      // If reconnecting after disconnect, include 'since' param to recover missed events
      let sseUrl = '/api/sse'
      if (this.wasDisconnected && this.lastEventTime > 0) {
        sseUrl = `/api/sse?since=${this.lastEventTime}`
        log.info({ since: new Date(this.lastEventTime).toISOString() }, '🔗 [SSEManager] Reconnecting')
      }

      this.eventSource = new EventSource(sseUrl, { withCredentials: true })
      this.eventSource.onopen = this.handleOpen.bind(this)
      this.eventSource.onmessage = this.handleMessage.bind(this)
      this.eventSource.onerror = this.handleError.bind(this)

    } catch (error) {
      log.error({ err: error }, '🔗 [SSE Manager] ❌ FATAL: Failed to create EventSource:')
      log.error({
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : 'No stack trace'
      }, '🔗 [SSE Manager] Error details:')
      this.handleError(error as Event)
    }
  }

  /**
   * Handle SSE connection open
   */
  private handleOpen() {
    this.isConnecting = false
    this.isConnected = true
    this.connectionAttempts = 0
    this.lastEventTime = Date.now()

    // Start heartbeat monitoring
    this.startHeartbeatMonitoring()

    // Clear any reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    // Notify connection listeners
    this.connectionListeners.forEach(callback => callback(true))

    // If this is a reconnection (was previously disconnected), notify reconnection listeners
    if (this.wasDisconnected) {
      if (process.env.NODE_ENV === 'development') {
        log.info('🔄 [SSE Manager] Reconnected - notifying listeners')
      }
      this.reconnectionListeners.forEach(callback => {
        try {
          callback()
        } catch (error) {
          log.error({ err: error }, '❌ [SSE Manager] Error in reconnection listener:')
        }
      })
      this.wasDisconnected = false
    }
  }

  // Dedup: track recently dispatched events to suppress rapid-fire duplicates from the server
  private recentEventKeys = new Map<string, number>()

  /**
   * Handle incoming SSE messages
   */
  private handleMessage(event: MessageEvent) {
    try {
      const eventData: SSEEvent = safeEventParse<SSEEvent>(
        event.data,
        {
          type: 'error',
          timestamp: new Date().toISOString(),
          data: { error: 'Invalid event data' }
        }
      )

      // Skip error events (parsing failed)
      if (eventData.type === 'error' && eventData.data?.error === 'Invalid event data') {
        log.warn('⚠️ [SSE Manager] Skipping invalid event data')
        return
      }

      // Update last event time and restart heartbeat monitoring
      this.lastEventTime = new Date(eventData.timestamp).getTime()
      this.startHeartbeatMonitoring()

      // Handle reconnect event from server (graceful close before timeout)
      if (eventData.type === 'reconnect') {
        if (process.env.NODE_ENV === 'development') {
          log.info(eventData.data?.reason || 'Unknown reason', '🔄 [SSE Manager] Server requested graceful reconnection:')
        }
        this.handleGracefulReconnect()
        return
      }

      // Skip ping events
      if (eventData.type === 'ping') {
        return
      }

      // Dedup: suppress rapid-fire identical events (same type + entity within 1s)
      const entityId = eventData.data?.taskId || eventData.data?.task?.id ||
                       eventData.data?.commentId || eventData.data?.comment?.id ||
                       eventData.data?.listId || eventData.data?.list?.id ||
                       eventData.data?.channelId
      if (entityId) {
        const dedupKey = `${eventData.type}:${entityId}`
        const now = Date.now()
        const lastSeen = this.recentEventKeys.get(dedupKey)
        if (lastSeen && now - lastSeen < 1000) {
          return // Suppress duplicate
        }
        this.recentEventKeys.set(dedupKey, now)
        // Prune old entries
        if (this.recentEventKeys.size > 200) {
          const cutoff = now - 10000
          for (const [key, ts] of this.recentEventKeys) {
            if (ts < cutoff) this.recentEventKeys.delete(key)
          }
        }
      }

      // Route event to relevant subscribers
      this.routeEvent(eventData)

    } catch (error) {
      log.error({ err: error }, '❌ [SSE Manager] Error parsing SSE event:')
    }
  }

  /**
   * Route events to subscribers
   */
  private routeEvent(event: SSEEvent) {
    this.subscriptions.forEach(subscription => {
      // Check if this subscription cares about this event type
      if (subscription.eventTypes.includes(event.type) || subscription.eventTypes.includes('*')) {
        try {
          subscription.callback(event)
        } catch (error) {
          log.error({ err: error }, `❌ [SSE Manager] Error in subscription ${subscription.id}:`)
        }
      }
    })
  }

  /**
   * Handle graceful reconnection requested by server
   */
  private handleGracefulReconnect() {
    // Set flag to prevent error logging and connection attempt counting
    this.isGracefulReconnect = true
    this.wasDisconnected = true

    // Close current connection
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    this.isConnected = false
    this.isConnecting = false

    // Reconnect immediately (the error handler will be called but will be ignored)
    setTimeout(() => {
      this.isGracefulReconnect = false
      this.connect()
    }, 100)
  }

  /**
   * Handle SSE connection errors
   */
  private handleError(error: Event) {
    // Skip error handling if this is a graceful reconnect
    if (this.isGracefulReconnect) {
      return
    }

    // Check if this is a normal close (readyState === CLOSED)
    const eventSource = error.target as EventSource
    const isNormalClose = eventSource?.readyState === EventSource.CLOSED

    // Only log errors in development for unexpected failures
    if (process.env.NODE_ENV === 'development' && !isNormalClose) {
      log.error({ err: error }, '❌ [SSE Manager] SSE Error:')
    }

    this.isConnecting = false
    this.isConnected = false
    this.wasDisconnected = true // Mark as disconnected for reconnection detection

    // Notify connection listeners
    this.connectionListeners.forEach(callback => callback(false))

    // Close and cleanup
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    this.connectionAttempts++

    // Use exponential backoff for reconnection (max 30 seconds)
    const delay = Math.min(3000 * Math.pow(2, Math.min(this.connectionAttempts - 1, 3)), 30000)

    // Circuit breaker: stop trying after 10 consecutive failures
    if (this.connectionAttempts >= 10) {
      log.warn('🚫 [SSE Manager] Circuit breaker activated - too many consecutive failures')
      return
    }

    // Schedule reconnection if we have active subscriptions
    if (this.subscriptions.size > 0 && !this.reconnectTimeout) {
      // Debug: Scheduling reconnection
      this.reconnectTimeout = setTimeout(() => {
        this.reconnectTimeout = null
        this.connect()
      }, delay)
    }
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeatMonitoring() {
    // Clear any existing heartbeat timeout
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout)
    }

    // Set timeout for 60 seconds (server pings every 15s, so this allows 4 missed pings)
    this.heartbeatTimeout = setTimeout(() => {
      log.warn('💓 [SSE Manager] Heartbeat timeout - no ping received for 60 seconds')

      // Trigger reconnection
      if (this.eventSource) {
        this.handleError({ type: 'heartbeat_timeout' } as Event)
      }
    }, 60000)
  }

  /**
   * Handle page visibility changes
   */
  private handleVisibilityChange() {
    if (!document.hidden && !this.isConnected && this.subscriptions.size > 0) {
      // Debug: Tab became visible, reconnecting
      // Reset connection attempts to break circuit breaker
      this.connectionAttempts = 0
      this.connect()
    }
  }

  /**
   * Disconnect from SSE
   */
  private disconnect() {
    // Debug: Disconnecting from SSE

    this.isConnecting = false
    this.isConnected = false

    // Clear all timeouts
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout)
      this.heartbeatTimeout = null
    }

    // Close EventSource
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }

    this.connectionAttempts = 0

    // Notify connection listeners
    this.connectionListeners.forEach(callback => callback(false))
  }

  /**
   * Force reconnection (for testing/debugging)
   */
  forceReconnect() {
    // Debug: Force reconnecting
    this.disconnect()
    if (this.subscriptions.size > 0) {
      setTimeout(() => this.connect(), 1000)
    }
  }

  /**
   * Get debug information
   */
  getDebugInfo() {
    const subscriptionsByComponent = new Map<string, number>()

    this.subscriptions.forEach(sub => {
      const component = sub.component || 'unknown'
      subscriptionsByComponent.set(component, (subscriptionsByComponent.get(component) || 0) + 1)
    })

    return {
      connectionStatus: this.getConnectionStatus(),
      subscriptions: Array.from(this.subscriptions.values()).map(sub => ({
        id: sub.id,
        component: sub.component,
        eventTypes: sub.eventTypes
      })),
      subscriptionsByComponent: Object.fromEntries(subscriptionsByComponent)
    }
  }
}

// Create singleton instance
export const SSEManager = new SSEManagerClass()

// Export default instance
export default SSEManager