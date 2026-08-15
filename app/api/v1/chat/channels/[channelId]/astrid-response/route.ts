/**
 * POST /api/v1/chat/channels/:channelId/astrid-response
 *
 * Called by a client that has DECIDED NOT to answer Astrid on device, so the
 * server answers instead. Task f0700542; Jon picked this over making the
 * server authoritative, so on-device Astrid keeps its privacy and latency.
 *
 * Body: { message_id: string, content: string }
 *   message_id — the user's message being replied to. Idempotency key.
 *   content    — that message with @mention markup already stripped, which the
 *                client does today via OnDeviceAstrid.plainMessage.
 *
 * The flow lives in lib/astrid-handoff.ts. This handler owns only auth and the
 * v1 envelope.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { handOffAstridReply } from '@/lib/astrid-handoff'
import { createLogger } from '@/lib/logger'
import { BRAND } from '@/lib/brand/config'

const log = createLogger('v1.chat.astrid-response')

type RouteContext = { params: Promise<{ channelId: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['chat:write'], tag: 'v1.chat.astrid-response' },
  async (req, auth, { params }) => {
    const { channelId } = await params

    let body: { message_id?: unknown; content?: unknown }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const result = await handOffAstridReply({
      channelId,
      userId: auth.userId,
      messageId: body.message_id,
      content: body.content,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    log.info({ channelId, dispatched: result.dispatched }, `${BRAND.appName} handoff accepted`)

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    // 202, not 201: the reply has not been written yet. Generation is
    // fire-and-forget and arrives over SSE like any other chat message, so a
    // client must not wait on this response for the answer.
    return NextResponse.json(
      {
        accepted: true,
        dispatched: result.dispatched,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { status: 202, headers }
    )
  }
)
