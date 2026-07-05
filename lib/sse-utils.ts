import { Redis } from '@upstash/redis'
import { createLogger } from '@/lib/logger'

const log = createLogger('sse-utils')


// Global SSE connection registry to ensure state is shared across all API routes
declare global {
  var __sseConnections: Map<string, Map<string, {
    controller: ReadableStreamDefaultController
    lastPing: number
    isAlive: boolean
    connectionId: string
    connectedAt: number
    lastEventCheck: number
  }>> | undefined
  var __sseConnectionIdCounter: number | undefined
  var __sseRecentEvents: Map<string, Array<{
    event: any
    timestamp: number
  }>> | undefined
}

// Recent events cache - stores last 15 minutes of events per user for reconnection recovery
const RECENT_EVENTS_TTL_MS = 15 * 60 * 1000 // 15 minutes
const MAX_EVENTS_PER_USER = 50 // Maximum events to cache per user
const REDIS_EVENT_TTL_SECONDS = 15 * 60 // 15 minutes in Redis

// In-memory fallback for development
const recentEvents = globalThis.__sseRecentEvents ?? new Map<string, Array<{
  event: any
  timestamp: number
}>>()
globalThis.__sseRecentEvents = recentEvents

// Redis client for cross-instance event sharing (production only)
let redisClient: Redis | null = null
function getRedisForSSE(): Redis | null {
  if (redisClient) return redisClient

  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    redisClient = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    return redisClient
  }
  return null
}

// Use global state to ensure connections are shared across all API route contexts
const connections = globalThis.__sseConnections ?? new Map<string, Map<string, {
  controller: ReadableStreamDefaultController
  lastPing: number
  isAlive: boolean
  connectionId: string
  connectedAt: number
  lastEventCheck: number
}>>()

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
export function registerConnection(userId: string, controller: ReadableStreamDefaultController) {
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

  // Add this new connection to the user's connections
  // Debug: Storing new connection for user
  userConnections.set(connectionId, {
    controller,
    lastPing: now,
    isAlive: true,
    connectionId,
    connectedAt: now,
    lastEventCheck: now
  })

  return connectionId
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
      try {
        connection.isAlive = false
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
      try {
        connection.isAlive = false
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
export async function broadcastToUsers(userIds: string[], event: any) {
  const encoder = new TextEncoder()
  // Send as unnamed event (like ping) so it's received by onmessage handler
  // Include type and timestamp in the data payload
  const fullEvent = {
    type: event.type,
    timestamp: event.timestamp || new Date().toISOString(),
    data: sanitizeForSSE(event.data)
  }
  const eventData = JSON.stringify(fullEvent)
  const sseMessage = `data: ${eventData}\n\n`

  const deadConnectionIds: Array<{userId: string, connectionId: string}> = []
  const cachePromises: Promise<void>[] = []

  userIds.forEach(userId => {
    // ALWAYS cache event for user (even if not connected) for reconnection recovery
    // Skip caching for ping/pong/connected events
    if (!['ping', 'pong', 'connected', 'reconnect', 'agent_typing_start', 'agent_typing_stop'].includes(event.type)) {
      cachePromises.push(cacheEventForUser(userId, fullEvent))
    }

    const userConnections = connections.get(userId)
    log.info(`[SSE] User ${userId} has ${userConnections?.size || 0} connections`)
    if (userConnections && userConnections.size > 0) {
      log.info(`[SSE] Broadcasting ${event.type} to ${userConnections.size} connections for user ${userId}`)

      userConnections.forEach((connection, connectionId) => {
        if (connection.isAlive) {
          try {
            connection.controller.enqueue(encoder.encode(sseMessage))
            connection.lastPing = Date.now()
            connection.lastEventCheck = Date.now()
            log.info(`[SSE] ✅ Sent ${event.type} to connection ${connectionId}`)
          } catch (error) {
            log.error({ err: error }, `[SSE] ❌ Failed to send SSE to user ${userId} connection ${connectionId}:`)
            // Mark connection as dead for cleanup
            connection.isAlive = false
            deadConnectionIds.push({userId, connectionId})
          }
        } else {
          log.info(`[SSE] ⚠️  Connection ${connectionId} is not alive, skipping`)
          deadConnectionIds.push({userId, connectionId})
        }
      })
    } else {
      log.info(`[SSE] ⚠️  No active connections for user ${userId} (event cached for reconnection)`)
    }
  })

  // Clean up dead connections
  deadConnectionIds.forEach(({userId, connectionId}) => {
    const userConnections = connections.get(userId)
    if (userConnections) {
      userConnections.delete(connectionId)
      // Debug: Removed dead connection

      // If no connections left, remove user entry
      if (userConnections.size === 0) {
        connections.delete(userId)
      }
    }
  })

  // Ensure all cache writes complete before returning so that
  // poll-based consumers (getMissedEvents) see the events.
  if (cachePromises.length > 0) {
    await Promise.allSettled(cachePromises)
  }
}

// Helper function to broadcast to all connected users
export async function broadcastToAll(event: any) {
  const userIds = Array.from(connections.keys())
  await broadcastToUsers(userIds, event)
}

// Helper function to send event to a specific user
export async function sendEventToUser(userId: string, event: any) {
  await broadcastToUsers([userId], event)
}

// Helper function to broadcast comment created notifications
export async function broadcastCommentCreatedNotification(
  task: any, // Task with lists, assignee, etc. included
  comment: any, // Comment with author included
  excludeUserId?: string // User ID to exclude from notifications (usually the comment author)
) {
  try {
    // Get all users who should receive updates
    const userIds = new Set<string>()

    // Add task assignee
    if (task.assigneeId) {
      userIds.add(task.assigneeId)
    }

    // Add task creator
    if (task.creatorId) {
      userIds.add(task.creatorId)
    }

    // Add all list members from all associated lists
    for (const list of task.lists) {
      // List owner
      userIds.add(list.ownerId)

      // List members from listMembers table
      if (list.listMembers) {
        list.listMembers.forEach((member: any) => userIds.add(member.userId))
      }
    }

    // Debug: Log users before removing commenter
    log.info(Array.from(userIds), '🔍 Comment SSE debug - All users who should be notified:')
    log.info(comment.authorId, '🔍 Comment SSE debug - Comment author:')
    log.info({ excludeUserId }, '🔍 Comment SSE debug - Exclude user ID:')

    // Remove the excluded user (usually the comment author, since they already see it)
    if (excludeUserId) {
      userIds.delete(excludeUserId)
    }

    log.info(Array.from(userIds), '🔍 Comment SSE debug - Users after removing excluded:')

    // Broadcast to all relevant users
    if (userIds.size > 0) {
      log.info(Array.from(userIds), '🔍 Comment SSE debug - Broadcasting comment_created to:')
      broadcastToUsers(Array.from(userIds), {
        type: 'comment_created',
        timestamp: new Date().toISOString(),
        data: {
          taskId: task.id,
          taskTitle: task.title,
          commentId: comment.id,
          commentContent: comment.content.substring(0, 100), // First 100 chars for preview
          commenterName: comment.author?.name || comment.author?.email || "AI Agent",
          userId: comment.authorId, // Add userId for client-side filtering
          listNames: (task.lists || []).filter((list: any) => list != null).map((list: any) => list.name),
          comment: {
            id: comment.id,
            content: comment.content,
            authorName: comment.author?.name || comment.author?.email || null,
            authorId: comment.authorId,
            isAgent: comment.author?.isAIAgent ?? false,
            createdAt: new Date(comment.createdAt).toISOString(),
            // Legacy fields for web client compatibility
            type: comment.type,
            author: comment.author,
            parentCommentId: comment.parentCommentId,
            secureFiles: comment.secureFiles ?? []
          }
        }
      })
      log.info('✅ Comment SSE notification sent successfully')
    } else {
      log.info('⚠️ No users to notify for comment SSE notification')
    }
  } catch (sseError) {
    log.error({ err: sseError }, "Failed to send comment SSE notifications:")
    // Don't throw - this should not break comment creation
  }
}

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

// ============================================
// RECENT EVENTS CACHE - For reconnection recovery
// Uses Redis in production for cross-instance sharing
// ============================================

/**
 * Store an event in Redis (production) or memory (development)
 * Called automatically by broadcastToUsers
 */
async function cacheEventForUser(userId: string, event: any) {
  const timestamp = Date.now()
  const redis = getRedisForSSE()

  if (redis) {
    // Production: one sorted set per user (score = timestamp). Replaces the
    // former one-key-per-event scheme, whose retrieval SCANned the ENTIRE
    // Redis keyspace per connection every 15s (hundreds of REST round trips).
    // Now: one ZADD + a bounded ZREMRANGEBYSCORE prune per event.
    try {
      const key = `sse:events:${userId}`
      // Unique member so two same-ms events don't collide/dedup in the set.
      const member = JSON.stringify({ event, timestamp, n: globalThis.crypto.randomUUID() })
      await redis.zadd(key, { score: timestamp, member })
      // Prune events older than the TTL window + set a whole-key expiry backstop.
      await redis.zremrangebyscore(key, 0, timestamp - REDIS_EVENT_TTL_SECONDS * 1000)
      await redis.expire(key, REDIS_EVENT_TTL_SECONDS)
    } catch (error) {
      log.error({ err: error }, '[SSE] Failed to cache event in Redis:')
      // Fall back to in-memory
      cacheEventInMemory(userId, event, timestamp)
    }
  } else {
    // Development: Use in-memory cache
    cacheEventInMemory(userId, event, timestamp)
  }
}

function cacheEventInMemory(userId: string, event: any, timestamp: number) {
  let userEvents = recentEvents.get(userId)
  if (!userEvents) {
    userEvents = []
    recentEvents.set(userId, userEvents)
  }

  userEvents.push({ event, timestamp })

  if (userEvents.length > MAX_EVENTS_PER_USER) {
    userEvents.shift()
  }
}

/**
 * Get missed events for a user since a specific timestamp
 * Checks Redis in production, memory in development
 */
export async function getMissedEvents(userId: string, sinceTimestamp: number): Promise<any[]> {
  const redis = getRedisForSSE()

  if (redis) {
    try {
      // One O(log n) range read from the user's sorted set — no keyspace scan.
      const key = `sse:events:${userId}`
      const members = await redis.zrange<string[]>(
        key, `(${sinceTimestamp}`, '+inf', { byScore: true }
      )
      const events = members
        .map(m => (typeof m === 'string' ? JSON.parse(m) : m))
        .filter((p: any) => p.timestamp > sinceTimestamp)
        .map((p: any) => p.event)
      log.info(`[SSE] getMissedEvents from Redis for user ${userId}: ${events.length} events`)
      return events
    } catch (error) {
      log.error({ err: error }, '[SSE] Failed to get events from Redis:')
      // Fall back to in-memory
    }
  }

  // Development or Redis fallback: Use in-memory cache
  const userEvents = recentEvents.get(userId)
  if (!userEvents) {
    return []
  }

  const missedEvents = userEvents
    .filter(e => e.timestamp > sinceTimestamp)
    .map(e => e.event)

  log.info(`[SSE] getMissedEvents from memory for user ${userId}: ${missedEvents.length} events`)
  return missedEvents
}

/**
 * Check Redis for new events and send to connected user
 * Called periodically for each connection
 */
export async function checkAndDeliverNewEvents(userId: string, connectionId: string): Promise<number> {
  const userConnections = connections.get(userId)
  if (!userConnections) return 0

  const connection = userConnections.get(connectionId)
  if (!connection || !connection.isAlive) return 0

  const redis = getRedisForSSE()
  if (!redis) return 0

  try {
    const lastCheck = connection.lastEventCheck
    const events = await getMissedEvents(userId, lastCheck)

    if (events.length > 0) {
      const encoder = new TextEncoder()

      for (const event of events) {
        const sseMessage = `data: ${JSON.stringify(event)}\n\n`
        try {
          connection.controller.enqueue(encoder.encode(sseMessage))
        } catch (error) {
          log.error({ err: error }, `[SSE] Failed to deliver event to ${connectionId}:`)
          connection.isAlive = false
          return events.length
        }
      }

      log.info(`[SSE] Delivered ${events.length} events from Redis to ${connectionId}`)
    }

    // Update last check time
    connection.lastEventCheck = Date.now()
    return events.length
  } catch (error) {
    log.error({ err: error }, '[SSE] Error checking for new events:')
    return 0
  }
}

/**
 * Clean up old events from the cache
 */
function cleanupOldEvents() {
  const cutoff = Date.now() - RECENT_EVENTS_TTL_MS

  recentEvents.forEach((userEvents, userId) => {
    // Filter out events older than TTL
    const filteredEvents = userEvents.filter(e => e.timestamp > cutoff)

    if (filteredEvents.length === 0) {
      recentEvents.delete(userId)
    } else if (filteredEvents.length !== userEvents.length) {
      recentEvents.set(userId, filteredEvents)
    }
  })
}

// Cleanup old events every 5 minutes
setInterval(cleanupOldEvents, 5 * 60 * 1000)