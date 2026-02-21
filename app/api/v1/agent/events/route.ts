/**
 * Agent SSE Events Endpoint
 *
 * GET /api/v1/agent/events
 *
 * SSE stream filtered to the authenticated agent's tasks.
 * Sends: task.assigned, task.commented, task.updated, task.completed, task.deleted
 * Supports ?since=ISO8601 for replaying missed events.
 *
 * This endpoint registers in the shared SSE connection pool so that
 * broadcastToUsers() delivers events directly (real-time push). A proxy
 * controller transforms internal events into agent protocol format.
 * A 5-second poll remains as a safety net for edge cases.
 */

import { NextRequest } from 'next/server'
import { authenticateAgentRequest, transformEventForAgent } from '@/lib/agent-protocol'
import { registerConnection, removeConnection, getMissedEvents } from '@/lib/sse-utils'
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
  const decoder = new TextDecoder()

  const stream = new ReadableStream({
    start(controller) {
      let lastCheckTime = Date.now()

      // Send connected event
      controller.enqueue(encoder.encode(`event: connected\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`))

      // ── Direct push via global SSE pool ──────────────────────────────
      // Register a proxy controller that transforms raw internal events
      // (from broadcastToUsers) into agent protocol named SSE events.
      const proxyController = {
        enqueue(chunk: Uint8Array) {
          const text = decoder.decode(chunk)
          const match = text.match(/^data: ([\s\S]+)\n\n$/)
          if (!match) return // skip non-data messages (keepalive, etc.)
          try {
            const parsed = JSON.parse(match[1])
            // Advance the poll cursor so we don't re-deliver this event
            lastCheckTime = Date.now()
            transformEventForAgent(parsed).then(transformed => {
              if (transformed) {
                try {
                  controller.enqueue(
                    encoder.encode(`event: ${transformed.type}\ndata: ${JSON.stringify(transformed.data)}\n\n`)
                  )
                } catch { /* stream closed */ }
              }
            }).catch(err => {
              console.error('[Agent SSE] Transform error during direct push:', err)
            })
          } catch { /* malformed JSON */ }
        },
        close() {
          try { controller.close() } catch {}
        },
      } as unknown as ReadableStreamDefaultController

      const connectionId = registerConnection(userId, proxyController)

      // ── Replay missed events ─────────────────────────────────────────
      if (sinceTimestamp && !isNaN(sinceTimestamp)) {
        lastCheckTime = sinceTimestamp
        getMissedEvents(userId, sinceTimestamp)
          .then(async (events) => {
            for (const event of events) {
              try {
                const transformed = await transformEventForAgent(event)
                if (transformed) {
                  controller.enqueue(
                    encoder.encode(`event: ${transformed.type}\ndata: ${JSON.stringify(transformed.data)}\n\n`)
                  )
                }
              } catch (err) {
                console.error('[Agent SSE] Transform error during replay:', err)
              }
            }
            lastCheckTime = Date.now()
          })
          .catch(err => console.error('[Agent SSE] Replay error:', err))
      }

      // ── Safety-net poll (5s) ─────────────────────────────────────────
      // Catches events that might slip through if the proxy registration
      // races with a concurrent broadcastToUsers call.
      const pollInterval = setInterval(async () => {
        try {
          const checkTime = lastCheckTime
          const events = await getMissedEvents(userId, checkTime)
          lastCheckTime = Date.now()

          for (const event of events) {
            try {
              const transformed = await transformEventForAgent(event)
              if (transformed) {
                controller.enqueue(
                  encoder.encode(`event: ${transformed.type}\ndata: ${JSON.stringify(transformed.data)}\n\n`)
                )
              }
            } catch (err) {
              console.error('[Agent SSE] Transform error during poll:', err)
            }
          }

          controller.enqueue(encoder.encode(':keepalive\n\n'))
        } catch {
          clearInterval(pollInterval)
        }
      }, 5_000)

      // Refresh connection every 5 minutes
      const refreshTimeout = setTimeout(() => {
        try {
          controller.enqueue(
            encoder.encode(`event: reconnect\ndata: ${JSON.stringify({ reason: 'periodic refresh' })}\n\n`)
          )
        } catch {}
        clearInterval(pollInterval)
        try { controller.close() } catch {}
      }, 300_000)

      const cleanup = () => {
        clearInterval(pollInterval)
        clearTimeout(refreshTimeout)
        removeConnection(userId, connectionId)
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
