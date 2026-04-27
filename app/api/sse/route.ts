import { getServerSession } from "next-auth"
import { NextRequest } from "next/server"
import { authConfig } from "@/lib/auth-config"
import { authenticateAPI, type AuthContext } from "@/lib/api-auth-middleware"
import { hasRequiredScopes } from "@/lib/oauth/oauth-scopes"
import { registerConnection, removeConnection, updateConnectionPing, getMissedEvents, checkAndDeliverNewEvents } from "@/lib/sse-utils"

// Explicitly use Node.js runtime for SSE compatibility in production
export const runtime = 'nodejs'

type SSESession = { user: { id: string; email?: string | null; name?: string | null; image?: string | null }; expires?: string } | null

export async function GET(request: NextRequest) {
  console.log('[SSE] GET request received')

  // Debug: Log all cookies from the request
  const cookieHeader = request.headers.get('cookie')
  console.log('[SSE] Cookie header:', cookieHeader ? `${cookieHeader.substring(0, 100)}...` : 'NONE')

  // Debug: Log all headers
  console.log('[SSE] Request headers:', {
    'user-agent': request.headers.get('user-agent'),
    'accept': request.headers.get('accept'),
    'origin': request.headers.get('origin'),
  })

  let session: SSESession = null

  try {
    // Priority 1: OAuth Bearer token (for OpenClaw and API clients)
    const authHeader = request.headers.get('authorization')
    if (authHeader?.toLowerCase().startsWith('bearer ')) {
      try {
        const auth: AuthContext = await authenticateAPI(request)
        // Check for sse:connect or tasks:read scope
        if (!hasRequiredScopes(auth.scopes, ['sse:connect']) && !hasRequiredScopes(auth.scopes, ['tasks:read']) && !hasRequiredScopes(auth.scopes, ['*'])) {
          console.log('[SSE] OAuth token missing required scope (sse:connect or tasks:read)')
          return new Response('Forbidden - Missing required scope: sse:connect or tasks:read', { status: 403 })
        }
        console.log(`[SSE] Authenticated via OAuth: ${auth.user.email} (source: ${auth.source})`)
        session = {
          user: {
            id: auth.userId,
            email: auth.user.email,
            name: auth.user.name,
          }
        }
      } catch (oauthError) {
        console.log('[SSE] OAuth authentication failed:', oauthError)
        return new Response('Unauthorized - Invalid Bearer token', { status: 401 })
      }
    }

    // Priority 2: Session-based auth (existing web UI flow)
    if (!session) {
      session = await getServerSession(authConfig) as SSESession
      console.log('[SSE] Session result:', session ? `User: ${session.user?.email}` : 'NO SESSION')

      // If JWT session validation failed, try database session (for mobile apps)
      if (!session?.user && cookieHeader) {
        console.log('[SSE] JWT validation failed, trying database session...')

        // Extract session token from cookie header
        const sessionTokenMatch = cookieHeader.match(/next-auth\.session-token=([^;]+)/)
        if (sessionTokenMatch) {
          const sessionToken = sessionTokenMatch[1]
          console.log('[SSE] Found session token, checking database...')

          // Check database for valid session
          const { prisma } = await import("@/lib/prisma")
          const dbSession = await prisma.session.findUnique({
            where: { sessionToken },
            include: { user: true }
          })

          if (dbSession && dbSession.expires > new Date()) {
            console.log('[SSE] Valid database session found for:', dbSession.user.email)
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
            console.log('[SSE] Database session expired or not found')
          }
        }
      }
    }

    if (!session?.user) {
      console.log('[SSE] Unauthorized - no valid session found')
      return new Response('Unauthorized', { status: 401 })
    }

    // Debug: Setting up SSE connection for user
  } catch (authError) {
    console.error('[SSE] Authentication error:', authError)
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
        console.log(`[SSE] Client reconnecting with since=${new Date(sinceTimestamp).toISOString()}`)
        // getMissedEvents is now async (checks Redis in production)
        getMissedEvents(userId, sinceTimestamp).then(missedEvents => {
          if (missedEvents.length > 0) {
            console.log(`[SSE] Sending ${missedEvents.length} missed events to user ${userId}`)
            missedEvents.forEach((event, index) => {
              try {
                const eventData = JSON.stringify(event)
                controller.enqueue(encoder.encode(`data: ${eventData}\n\n`))
                console.log(`[SSE] ✅ Sent missed event ${index + 1}/${missedEvents.length}: ${event.type}`)
              } catch (error) {
                console.error(`[SSE] ❌ Failed to send missed event:`, error)
              }
            })
          } else {
            console.log(`[SSE] No missed events for user ${userId}`)
          }
        }).catch(err => {
          console.error(`[SSE] Error fetching missed events:`, err)
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
          console.error(`[SSE] Ping failed for user ${userId}, connection likely closed:`, error)
          cleanup()
        }
      }, 15000)

      // Graceful connection refresh to maintain SSE reliability.
      // Vercel streaming responses support much longer connections than serverless function timeouts;
      // we refresh every ~25 minutes to keep connections healthy without aggressive reconnect loops.
      const connectionTimeout = setTimeout(() => {
        if (cleanedUp) return
        console.log(`[SSE] Proactively closing connection for user ${userId} for periodic refresh`)

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
      }, 1500000) // 25 minutes

      request.signal.addEventListener('abort', cleanup)
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': process.env.NODE_ENV === 'production' ? 'https://www.astrid.cc' : '*',
      'Access-Control-Allow-Headers': 'Cache-Control, Cookie, Authorization',
      'Access-Control-Allow-Credentials': 'true',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
      'Transfer-Encoding': 'chunked'
    }
  })
}