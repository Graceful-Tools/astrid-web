/**
 * Agent SSE Events Endpoint
 *
 * GET /api/v1/agent/events
 *
 * SSE stream filtered to the authenticated agent's tasks.
 * Sends: task.assigned, task.commented, task.updated, task.completed, task.deleted
 * Supports ?since=ISO8601 for replaying missed events.
 */

import { NextRequest } from 'next/server'
import { authenticateAgentRequest, enrichTaskForAgent, agentTaskInclude, AGENT_EVENT_TYPES, mapEventType } from '@/lib/agent-protocol'
import { registerConnection, removeConnection, updateConnectionPing, getMissedEvents, checkAndDeliverNewEvents } from '@/lib/sse-utils'
import { AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'
import { createRateLimitHeaders } from '@/lib/rate-limiter'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  let auth
  try {
    auth = await authenticateAgentRequest(request, ['tasks:read', 'sse:connect'])
  } catch {
    return new Response('Unauthorized', { status: 401 })
  }

  // Per-client SSE connection rate limit
  ;(request as any).__agentClientId = auth.clientId
  ;(request as any).__agentUserId = auth.userId
  const sseRateResult = await AGENT_RATE_LIMITS.SSE.checkRateLimitAsync(request)
  if (!sseRateResult.allowed) {
    const retryAfter = Math.ceil((sseRateResult.resetTime - Date.now()) / 1000)
    return new Response(JSON.stringify({ error: 'Too many SSE connections', retryAfter }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...createRateLimitHeaders(sseRateResult),
        'Retry-After': retryAfter.toString(),
      },
    })
  }

  const userId = auth.userId
  const sinceParam = request.nextUrl.searchParams.get('since')
  const sinceTimestamp = sinceParam ? new Date(sinceParam).getTime() : null

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const connectionId = registerConnection(userId, controller)

      // Send connected event
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`))

      // Replay missed events if since provided
      if (sinceTimestamp && !isNaN(sinceTimestamp)) {
        getMissedEvents(userId, sinceTimestamp)
          .then(events => {
            for (const event of events) {
              const mappedType = mapEventType(event.type)
              if (mappedType) {
                controller.enqueue(
                  encoder.encode(`event: ${mappedType}\ndata: ${JSON.stringify(event.data || event)}\n\n`)
                )
              }
            }
          })
          .catch(err => console.error('[Agent SSE] Replay error:', err))
      }

      // Poll for events and send keepalive every 10s.
      // In production (Vercel), broadcastToUsers runs in separate serverless instances
      // that can't reach this connection directly. Events are cached in Redis,
      // so we poll Redis to deliver them — matching the pattern from /api/sse.
      const keepaliveInterval = setInterval(async () => {
        try {
          // Check Redis for events from other instances (production)
          await checkAndDeliverNewEvents(userId, connectionId)

          controller.enqueue(encoder.encode(':keepalive\n\n'))
          updateConnectionPing(userId)
        } catch {
          removeConnection(userId, connectionId)
          clearInterval(keepaliveInterval)
        }
      }, 10_000)

      // Refresh connection every 5 minutes
      const refreshTimeout = setTimeout(() => {
        try {
          controller.enqueue(
            encoder.encode(`event: reconnect\ndata: ${JSON.stringify({ reason: 'periodic refresh' })}\n\n`)
          )
        } catch {}
        removeConnection(userId, connectionId)
        clearInterval(keepaliveInterval)
        try { controller.close() } catch {}
      }, 300_000)

      const cleanup = () => {
        removeConnection(userId, connectionId)
        clearInterval(keepaliveInterval)
        clearTimeout(refreshTimeout)
      }

      request.signal.addEventListener('abort', cleanup)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
