import { BRAND } from '@/lib/brand/config'
import { getUnifiedSession } from "@/lib/session-utils"
import { NextRequest } from "next/server"
import { authenticateAPI, type AuthContext } from "@/lib/api-auth-middleware"
import { hasRequiredScopes } from "@/lib/oauth/oauth-scopes"
import { registerConnection, removeConnection, updateConnectionPing, getMissedEvents, checkAndDeliverNewEvents } from "@/lib/sse-utils"
import { createLogger } from "@/lib/logger"

const log = createLogger('SSE')

// Explicitly use Node.js runtime for SSE compatibility in production
export const runtime = 'nodejs'

/**
 * Route segment config, NOT vercel.json.
 *
 * vercel.json asked for 300s on this path, but production logs showed
 * "Task timed out after 30 seconds" on both /api/sse and /api/v1/sse — the
 * broad `app/api/**` 30s entry was what actually applied. Every client was
 * being cut off and reconnecting about twice a minute, each reconnect paying a
 * full authentication and a Redis read. Declaring it here is the form Next
 * passes to the platform, and it is the one that takes effect (task 0f544a13).
 *
 * SSE_REFRESH_MS below must stay under this ceiling.
 */
export const maxDuration = 300

/**
 * Refresh the stream 15s before maxDuration so the client gets a `reconnect`
 * event and can re-establish cleanly, rather than having the socket cut.
 */
const SSE_REFRESH_MS = (300 - 15) * 1000

type SSESession = { user: { id: string; email?: string | null; name?: string | null; image?: string | null }; expires?: string } | null

export async function GET(request: NextRequest) {
  log.debug('GET request received')

  // Inspect cookies from the request
  const cookieHeader = request.headers.get('cookie')
  log.debug({ cookiePrefix: cookieHeader ? `${cookieHeader.substring(0, 100)}...` : 'NONE' }, 'Cookie header')

  // Inspect headers
  log.debug({
    userAgent: request.headers.get('user-agent'),
    accept: request.headers.get('accept'),
    origin: request.headers.get('origin'),
  }, 'Request headers')

  let session: SSESession = null

  try {
    // Priority 1: OAuth Bearer token (for OpenClaw and API clients)
    const authHeader = request.headers.get('authorization')
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      try {
        const auth: AuthContext = await authenticateAPI(request)
        // Check for sse:connect or tasks:read scope
        if (!hasRequiredScopes(auth.scopes, ['sse:connect']) && !hasRequiredScopes(auth.scopes, ['tasks:read']) && !hasRequiredScopes(auth.scopes, ['*'])) {
          log.warn({ scopes: auth.scopes }, 'OAuth token missing required scope (sse:connect or tasks:read)')
          return new Response('Forbidden - Missing required scope: sse:connect or tasks:read', { status: 403 })
        }
        log.info({ email: auth.user.email, source: auth.source }, 'Authenticated via OAuth')
        session = {
          user: {
            id: auth.userId,
            email: auth.user.email,
            name: auth.user.name,
          }
        }
      } catch (oauthError) {
        log.warn({ err: oauthError }, 'OAuth authentication failed')
        return new Response('Unauthorized - Invalid Bearer token', { status: 401 })
      }
    }

    // Priority 2: Session-based auth (existing web UI flow)
    if (!session) {
      session = await getUnifiedSession() as SSESession
      log.debug({ email: session?.user?.email ?? null }, 'Session result')

      // If JWT session validation failed, try database session (for mobile apps)
      if (!session?.user && cookieHeader) {
        log.debug('JWT validation failed, trying database session...')

        // Extract session token from cookie header
        const sessionTokenMatch = cookieHeader.match(/next-auth\.session-token=([^;]+)/)
        if (sessionTokenMatch) {
          const sessionToken = sessionTokenMatch[1]
          log.debug('Found session token, checking database...')

          // Check database for valid session
          const { prisma } = await import("@/lib/prisma")
          const dbSession = await prisma.session.findUnique({
            where: { sessionToken },
            include: { user: true }
          })

          if (dbSession && dbSession.expires > new Date()) {
            log.debug({ email: dbSession.user.email }, 'Valid database session found')
            session = {
              user: {
                id: dbSession.user.id,
                email: dbSession.user.email,
                name: dbSession.user.name,
                image: dbSession.user.image,
              },
              expires: dbSession.expires.toISOString()
            }
          } else {
            log.debug('Database session expired or not found')
          }
        }
      }
    }

    if (!session?.user) {
      log.warn('Unauthorized - no valid session found')
      return new Response('Unauthorized', { status: 401 })
    }
  } catch (authError) {
    log.error({ err: authError }, 'Authentication error')
    return new Response('Authentication Error', { status: 500 })
  }

  // Parse 'since' query parameter for reconnection recovery
  const sinceParam = request.nextUrl.searchParams.get('since')
  const sinceTimestamp = sinceParam ? parseInt(sinceParam, 10) : null

  // Create a ReadableStream for Server-Sent Events
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const userId = session.user.id

      // Register this connection and get the connection ID
      const connectionId = registerConnection(userId, controller)
      // Debug: SSE connection registered

      // Debug: Check connections after registration

      // Send initial connection event
      const data = JSON.stringify({
        type: 'connected',
        timestamp: new Date().toISOString()
      })
      // Debug: Sending initial connection event
      controller.enqueue(encoder.encode(`data: ${data}\n\n`))

      // If client provided a 'since' timestamp, send any missed events
      if (sinceTimestamp && !isNaN(sinceTimestamp)) {
        log.debug({ since: new Date(sinceTimestamp).toISOString() }, 'Client reconnecting')
        // getMissedEvents is now async (checks Redis in production)
        getMissedEvents(userId, sinceTimestamp).then(missedEvents => {
          if (missedEvents.length > 0) {
            log.info({ userId, count: missedEvents.length }, 'Sending missed events')
            missedEvents.forEach((event, index) => {
              try {
                const eventData = JSON.stringify(event)
                controller.enqueue(encoder.encode(`data: ${eventData}\n\n`))
                log.debug({ index: index + 1, total: missedEvents.length, type: event.type }, 'Sent missed event')
              } catch (error) {
                log.error({ err: error }, 'Failed to send missed event')
              }
            })
          } else {
            log.debug({ userId }, 'No missed events')
          }
        }).catch(err => {
          log.error({ err }, 'Error fetching missed events')
        })
      }

      // Send keep-alive ping every 15 seconds and check Redis for new events
      // Single source of truth for whether this connection has been torn down.
      // Without this, the ping interval and the abort handler could each call
      // removeConnection() once, and an in-flight ping that started before
      // cleanup ran could still try to enqueue() against a closed controller.
      let cleanedUp = false
      const cleanup = () => {
        if (cleanedUp) return
        cleanedUp = true
        clearInterval(pingInterval)
        clearTimeout(connectionTimeout)
        removeConnection(userId, connectionId)
      }

      const pingInterval = setInterval(async () => {
        if (cleanedUp) return
        try {
          // First, check Redis for any new events from other instances
          await checkAndDeliverNewEvents(userId, connectionId)

          // Re-check after the await — the connection could have been torn
          // down while we were waiting on Redis.
          if (cleanedUp) return

          const pingData = JSON.stringify({
            type: 'ping',
            timestamp: new Date().toISOString()
          })

          controller.enqueue(encoder.encode(`data: ${pingData}\n\n`))
          updateConnectionPing(userId)
        } catch (error) {
          // Controller is closed or errored — clean up and stop pinging.
          log.warn({ userId, err: error }, 'Ping failed, connection likely closed')
          cleanup()
        }
      }, 15000)

      // Graceful connection refresh, timed to happen JUST BEFORE the platform
      // kills the invocation. This used to be 25 minutes on the belief that
      // streaming responses outlive the function timeout. They do not: the
      // function was being killed at its ceiling, so this timer never once
      // fired and every client saw a hard stream close instead of the orderly
      // reconnect it was written to give them (task 0f544a13).
      const connectionTimeout = setTimeout(() => {
        if (cleanedUp) return
        log.debug({ userId }, 'Proactively closing connection for periodic refresh')

        try {
          const closeData = JSON.stringify({
            type: 'reconnect',
            timestamp: new Date().toISOString(),
            data: { reason: 'Periodic connection refresh' }
          })
          controller.enqueue(encoder.encode(`data: ${closeData}\n\n`))
        } catch {
          // Controller already closed.
        }

        cleanup()

        try {
          controller.close()
        } catch {
          // Controller might already be closed.
        }
      }, SSE_REFRESH_MS)

      request.signal.addEventListener('abort', cleanup)
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': process.env.NODE_ENV === 'production' ? `https://www.${BRAND.domain}` : '*',
      'Access-Control-Allow-Headers': 'Cache-Control, Cookie, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
      'Transfer-Encoding': 'chunked'
    }
  })
}