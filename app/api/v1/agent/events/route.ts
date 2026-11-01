/**
 * Agent SSE Events Endpoint
 *
 * GET /api/v1/agent/events
 *
 * SSE stream filtered to the authenticated agent's tasks.
 * Sends: task.assigned, task.commented, task.updated, task.completed, task.deleted
 * Supports ?since=ISO8601 for replaying missed events.
 *
 * This endpoint registers on the realtime bus (lib/realtime/bus.ts) through
 * the shared SSE connection pool, so events published on any instance are
 * pushed to it. A proxy controller transforms internal events into agent
 * protocol format. The bus used to be backed up here by a 5-second
 * getMissedEvents poll whose cursor a direct push moved forward — the same
 * lost-event race as /api/sse (AWTD-1459). The bus now owns cross-instance
 * delivery; it is asked for <= 5 s latency to keep the old ceiling.
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  authenticateAgentRequest,
  transformEventForAgent,
  agentEventFingerprint,
  createAgentEventDedup,
} from '@/lib/agent-protocol'
import { registerConnection, removeConnection, getMissedEvents } from '@/lib/sse-utils'
import { AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'
import { createRateLimitHeaders } from '@/lib/rate-limiter'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.agent.events')

export const runtime = 'nodejs'

/**
 * The stream plans a 300s lifetime (the refresh timeout below), but vercel.json
 * only lifted the ceiling for app/api/sse/route.ts, so this route ran under the
 * broad 30s entry and was killed roughly ten times before its own refresh could
 * fire. Declared here because route segment config is what the platform
 * actually reads (task 0f544a13).
 */
export const maxDuration = 300

/** The cross-instance ceiling the old 5 s safety-net poll gave agents. */
const AGENT_EVENTS_MAX_LATENCY_MS = 5_000

export async function GET(request: NextRequest) {
  let auth
  try {
    auth = await authenticateAgentRequest(request, ['tasks:read', 'sse:connect'])
  } catch {
    // JSON like the other 129 handlers: an agent reading body.error off a text
    // body gets a parse failure instead of "your token expired", and retries
    // forever rather than re-authenticating (task 17fea642).
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
      // Time-windowed dedup (see createAgentEventDedup in lib/agent-protocol).
      const dedup = createAgentEventDedup()

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
            const fp = agentEventFingerprint(parsed)
            if (dedup.isDuplicate(fp)) return // already delivered
            transformEventForAgent(parsed).then(transformed => {
              if (transformed) {
                try {
                  const eventId = `${transformed.type}:${transformed.data?.taskId || ''}:${transformed.data?.comment?.id || ''}:${Date.now()}`
                  controller.enqueue(
                    encoder.encode(`id: ${eventId}\nevent: ${transformed.type}\ndata: ${JSON.stringify(transformed.data)}\n\n`)
                  )
                } catch { /* stream closed */ }
              }
            }).catch(err => {
              log.error({ err }, 'Transform error during direct push')
            })
          } catch { /* malformed JSON */ }
        },
        close() {
          try { controller.close() } catch {}
        },
      } as unknown as ReadableStreamDefaultController

      const connectionId = registerConnection(userId, proxyController, { maxLatencyMs: AGENT_EVENTS_MAX_LATENCY_MS })

      // ── Replay missed events ─────────────────────────────────────────
      // Sequential, awaiting each transform, so a replay arrives in order.
      if (sinceTimestamp && !isNaN(sinceTimestamp)) {
        getMissedEvents(userId, sinceTimestamp)
          .then(async (events) => {
            for (const event of events) {
              try {
                const fp = agentEventFingerprint(event)
                if (dedup.isDuplicate(fp)) continue
                const transformed = await transformEventForAgent(event)
                if (transformed) {
                  const eventId = `${transformed.type}:${transformed.data?.taskId || ''}:${transformed.data?.comment?.id || ''}:${Date.now()}`
                  controller.enqueue(
                    encoder.encode(`id: ${eventId}\nevent: ${transformed.type}\ndata: ${JSON.stringify(transformed.data)}\n\n`)
                  )
                }
              } catch (err) {
                log.error({ err }, 'Transform error during replay')
              }
            }
          })
          .catch(err => log.error({ err }, 'Replay error'))
      }

      // ── Keepalive (5s) ───────────────────────────────────────────────
      const pollInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: keepalive\ndata: ${JSON.stringify({ serverTime: new Date().toISOString() })}\n\n`))
        } catch {
          clearInterval(pollInterval)
        }
      }, 5_000)

      // Refresh 15s before maxDuration, so the client is handed a `reconnect`
      // event rather than having the socket cut from under it.
      const refreshTimeout = setTimeout(() => {
        try {
          controller.enqueue(
            encoder.encode(`event: reconnect\ndata: ${JSON.stringify({ reason: 'periodic refresh' })}\n\n`)
          )
        } catch {}
        clearInterval(pollInterval)
        try { controller.close() } catch {}
      }, (300 - 15) * 1000)

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
