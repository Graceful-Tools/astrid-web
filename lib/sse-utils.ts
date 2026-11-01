import { createLogger } from '@/lib/logger'
import { applyCommentActorRule } from '@/lib/comment-permissions'
import type { SseOutboundEvent } from '@/lib/sse-event-types'
import { getRealtimeBus, type SubscribeOptions } from '@/lib/realtime/bus'

const log = createLogger('sse-utils')

/**
 * This module is the connection registry; transport is the realtime bus
 * (lib/realtime/bus.ts, AWTD-1459). It used to talk to Upstash itself and poll
 * per connection from a `lastEventCheck` that a local delivery moved forward —
 * which lost any event another instance had written just before.
 */
type SseConnection = {
  controller: ReadableStreamDefaultController
  lastPing: number
  isAlive: boolean
  connectionId: string
  connectedAt: number
  /** Detaches this connection from the bus. */
  unsubscribe: () => void
}

// Global SSE connection registry to ensure state is shared across all API routes
declare global {
  var __sseConnections: Map<string, Map<string, SseConnection>> | undefined
  var __sseConnectionIdCounter: number | undefined
}

/** Delivered live, never written to the replay store. */
const EPHEMERAL_EVENT_TYPES = new Set(['ping', 'pong', 'connected', 'reconnect', 'agent_typing_start', 'agent_typing_stop'])

// Use global state to ensure connections are shared across all API route contexts
const connections = globalThis.__sseConnections ?? new Map<string, Map<string, SseConnection>>()

// Store the connections in global state
globalThis.__sseConnections = connections

// Connection ID counter for tracking individual connections (also global)
let connectionIdCounter = globalThis.__sseConnectionIdCounter ?? 0

// Cleanup dead connections every minute
setInterval(() => {
  const now = Date.now()

  connections.forEach((userConnections, userId) => {
    const staleConnectionIds: string[] = []

    userConnections.forEach((conn, connectionId) => {
      if (now - conn.lastPing > 90000) { // 90 seconds
        // Debug: Cleaning up stale connection
        conn.unsubscribe()
        try {
          conn.controller.close()
        } catch (e) {
          // Ignore close errors
        }
        staleConnectionIds.push(connectionId)
      }
    })

    // Remove stale connections
    staleConnectionIds.forEach(connectionId => {
      userConnections.delete(connectionId)
    })

    // If user has no connections left, remove the user entry
    if (userConnections.size === 0) {
      connections.delete(userId)
    }
  })
}, 60000)

// Helper function to register a new connection
/**
 * Register a stream and attach it to the realtime bus. Every event for
 * `userId` — published here or on any other instance — is written to
 * `controller` once, as `data: <json>\n\n`. With `options.since`, persisted
 * events newer than it are replayed first (reconnect recovery).
 */
export function registerConnection(
  userId: string,
  controller: ReadableStreamDefaultController,
  options: SubscribeOptions = {}
) {
  // Increment global counter and store it back
  connectionIdCounter = ++connectionIdCounter
  globalThis.__sseConnectionIdCounter = connectionIdCounter

  const connectionId = `conn_${connectionIdCounter}_${Date.now()}`
  const now = Date.now()

  // Get or create user connections map
  let userConnections = connections.get(userId)
  if (!userConnections) {
    userConnections = new Map()
    connections.set(userId, userConnections)
  }

  const encoder = new TextEncoder()
  const connection: SseConnection = {
    controller,
    lastPing: now,
    isAlive: true,
    connectionId,
    connectedAt: now,
    unsubscribe: () => {},
  }
  userConnections.set(connectionId, connection)

  connection.unsubscribe = getRealtimeBus().subscribe(userId, envelope => {
    if (!connection.isAlive) return
    try {
      connection.controller.enqueue(encoder.encode(`data: ${JSON.stringify(envelope.event)}\n\n`))
      connection.lastPing = Date.now()
      log.debug(`[SSE] ✅ Sent ${envelope.event.type} to connection ${connectionId}`)
    } catch (error) {
      log.error({ err: error }, `[SSE] ❌ Failed to send SSE to user ${userId} connection ${connectionId}:`)
      dropDeadConnection(userId, connectionId)
    }
  }, options)

  return connectionId
}

/** A connection whose controller threw: detach it without closing (it is already gone). */
function dropDeadConnection(userId: string, connectionId: string) {
  const userConnections = connections.get(userId)
  const connection = userConnections?.get(connectionId)
  if (!userConnections || !connection) return
  connection.isAlive = false
  connection.unsubscribe()
  userConnections.delete(connectionId)
  if (userConnections.size === 0) connections.delete(userId)
}

// Helper function to remove a specific connection
export function removeConnection(userId: string, connectionId?: string) {
  const userConnections = connections.get(userId)
  if (!userConnections) {
    // Debug: No connections found to remove for user
    return
  }

  if (connectionId) {
    // Remove specific connection
    const connection = userConnections.get(connectionId)
    if (connection) {
      // Debug: Removing specific connection
      connection.isAlive = false
      connection.unsubscribe()
      try {
        connection.controller.close()
      } catch (e) {
        // Debug: Error closing connection during removal
      }
      userConnections.delete(connectionId)

      // If no connections left, remove user entry
      if (userConnections.size === 0) {
        connections.delete(userId)
      }
    }
  } else {
    // Remove all connections for user
    // Debug: Removing all connections for user
    userConnections.forEach((connection, connId) => {
      connection.isAlive = false
      connection.unsubscribe()
      try {
        connection.controller.close()
      } catch (e) {
        // Debug: Error closing connection during removal
      }
    })
    connections.delete(userId)
  }
}

// Helper function to update ping time for all user connections
export function updateConnectionPing(userId: string) {
  const userConnections = connections.get(userId)
  if (userConnections) {
    userConnections.forEach(connection => {
      connection.lastPing = Date.now()
    })
  }
}

// Fields that should NEVER appear in SSE broadcasts
const SENSITIVE_USER_FIELDS = new Set([
  'password', 'emailVerificationToken', 'emailTokenExpiresAt',
  'mcpSettings', 'aiAssistantSettings', 'aiAgentConfig',
  'pendingEmail', 'myTasksPreferences', 'invitedBy',
])

// Safe user fields for SSE
const SAFE_USER_FIELDS = new Set([
  'id', 'name', 'email', 'image', 'isAIAgent', 'aiAgentType',
])

/**
 * Strip sensitive fields from objects before SSE broadcast.
 * Recursively sanitizes user objects and removes dangerous fields.
 */
function sanitizeForSSE(obj: any, depth = 0): any {
  if (depth > 8 || obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  if (obj instanceof Date) return obj
  if (Array.isArray(obj)) return obj.map(item => sanitizeForSSE(item, depth + 1))

  const result: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    // Strip known sensitive fields at any depth
    if (SENSITIVE_USER_FIELDS.has(key)) continue

    // If this looks like a user object (has email + id), restrict to safe fields
    if (key === 'user' && typeof value === 'object' && value !== null && 'id' in value && 'email' in value) {
      const safeUser: Record<string, any> = {}
      for (const field of Array.from(SAFE_USER_FIELDS)) {
        if (field in value) safeUser[field] = (value as any)[field]
      }
      result[key] = safeUser
      continue
    }

    result[key] = sanitizeForSSE(value, depth + 1)
  }
  return result
}

// Helper function to broadcast events to specific users
export async function broadcastToUsers(userIds: string[], event: SseOutboundEvent) {
  // Send as unnamed event (like ping) so it's received by onmessage handler
  // Include type and timestamp in the data payload
  const fullEvent = {
    type: event.type,
    timestamp: event.timestamp || new Date().toISOString(),
    data: sanitizeForSSE(event.data)
  }

  // Local connections are written synchronously inside publish; the shared
  // write is awaited so poll-based consumers on other instances see the event
  // once this resolves. Ephemeral events are never replayed.
  await getRealtimeBus().publish(userIds, fullEvent, { persist: !EPHEMERAL_EVENT_TYPES.has(event.type) })
}

// Helper function to broadcast to all connected users
export async function broadcastToAll(event: SseOutboundEvent) {
  const userIds = Array.from(connections.keys())
  await broadcastToUsers(userIds, event)
}

// Helper function to send event to a specific user
export async function sendEventToUser(userId: string, event: SseOutboundEvent) {
  await broadcastToUsers([userId], event)
}

// Helper function to broadcast comment created notifications
/**
 * SSE fan-out for a new comment on the legacy `/api/tasks/:id/comments` route.
 *
 * The author is IN the audience. This used to take an `excludeUserId` that the
 * route filled with the commenter, on the reasoning that they already see their
 * own comment — true of the tab that posted it and of no other device that user
 * has open. Receivers dedupe on comment id. The AI-agent exception lives in
 * `applyCommentActorRule`. (Task cb1581e0.)
 */
// Helper function to get connection status
export function getConnectionsStatus() {
  const allConnections: Array<{
    userId: string;
    connectionId: string;
    lastPing: number;
    isAlive: boolean;
    connectedAt: number;
    lastPingAgo: number;
    connectionAge: number;
  }> = []

  let totalConnections = 0

  connections.forEach((userConnections, userId) => {
    userConnections.forEach((conn, connectionId) => {
      totalConnections++
      allConnections.push({
        userId,
        connectionId: conn.connectionId,
        lastPing: conn.lastPing,
        isAlive: conn.isAlive,
        connectedAt: conn.connectedAt,
        lastPingAgo: Date.now() - conn.lastPing,
        connectionAge: Date.now() - conn.connectedAt
      })
    })
  })

  return {
    total: totalConnections,
    activeUserIds: Array.from(connections.keys()),
    connections: allConnections
  }
}

/**
 * Persisted events for a user newer than `sinceTimestamp`, oldest first —
 * the realtime bus's replay store.
 */
export async function getMissedEvents(userId: string, sinceTimestamp: number): Promise<any[]> {
  const envelopes = await getRealtimeBus().replaySince(userId, sinceTimestamp)
  // debug: fires on EVERY SSE connect and reports nothing actionable —
  // it was the second most common line in production (task 2e15b42f).
  log.debug(`[SSE] getMissedEvents for user ${userId}: ${envelopes.length} events`)
  return envelopes.map(e => e.event)
}
