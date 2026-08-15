/**
 * Server-side Astrid reply, handed off by a client that declined to answer.
 *
 * Task f0700542. iOS/Mac answer Astrid ON DEVICE when the Apple Foundation
 * model is both the selected assistant and available. When it is not — the
 * user picked a server-side agent, or the model is unavailable — the client
 * stays silent, and lib/chat-mention-dispatch.ts deliberately does not
 * dispatch Astrid either, to avoid two replies to one message. The result is
 * that nobody answers. This is the missing half.
 *
 * WHY AN EXPLICIT HANDOFF rather than a flag on POST /messages: a flag needs a
 * default, and both defaults are wrong for somebody. Default-on duplicates
 * replies for every already-shipped client that answers locally; default-off
 * leaves the gap open for anyone who never sends it. An endpoint that is only
 * ever called on purpose has no default to get wrong.
 *
 * ABSENCE MEANS TODAY'S BEHAVIOUR. If a client never calls this, the server
 * does not dispatch Astrid — exactly as now. Silence is the bug being fixed,
 * but it is strictly better than duplicate replies, and it is what every
 * shipped client depends on.
 *
 * IDEMPOTENCY IS TWO-LAYER, deliberately:
 *
 *   1. A Redis claim on the source message id, so a client retry over a flaky
 *      network is refused before any model call is made. This is the cheap
 *      layer and the one that saves the token spend.
 *   2. The REPLY row carries a unique `clientRequestId` derived from the same
 *      message id. If two generations race past layer 1 — different instances,
 *      cold cache, Redis down — the second insert violates the unique index and
 *      is swallowed by the runtime rather than posting a second reply.
 *
 * Layer 1 alone would be best-effort: `get`-then-`set` has a window, and
 * RedisCache exposes no atomic set-if-absent. Layer 2 alone would let a retry
 * burn a full model call before discovering the write is a duplicate. Together
 * the common case is cheap and the worst case is still correct.
 */

import { canAccessChatChannel } from '@/lib/chat-access'
import { resolveDefaultAgent } from '@/lib/resolve-default-agent'
import { processAstridMessage } from '@/lib/astrid-agent-runtime'
import { ASTRID_EMAIL } from '@/lib/astrid-agent'
import { broadcastToUsers } from '@/lib/sse-utils'
import { RedisCache } from '@/lib/redis'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { BRAND } from '@/lib/brand/config'

const log = createLogger('chat.astrid-handoff')

/** How long a handoff claim blocks a repeat for. Long enough to outlive a retry storm. */
const CLAIM_TTL_SECONDS = 600

const claimKey = (messageId: string) => `astrid-handoff:${messageId}`

/** The reply's idempotency key. Derived, so the caller cannot pick a colliding one. */
export const replyRequestId = (messageId: string) => `astrid-reply:${messageId}`

export type AstridHandoffResult =
  | { ok: true; dispatched: 'astrid' | 'external-agent' }
  | { ok: true; dispatched: 'none'; reason: 'duplicate' | 'no-agent' }
  | { ok: false; status: 400 | 403 | 404; error: string }

export async function handOffAstridReply(args: {
  channelId: string
  userId: string
  messageId?: unknown
  content?: unknown
}): Promise<AstridHandoffResult> {
  const { channelId, userId } = args

  if (typeof args.messageId !== 'string' || !args.messageId.trim()) {
    return { ok: false, status: 400, error: 'message_id is required' }
  }
  // Content may be empty in principle, but an empty prompt is not a question
  // worth spending a model call on.
  if (typeof args.content !== 'string' || !args.content.trim()) {
    return { ok: false, status: 400, error: 'content is required' }
  }

  const messageId = args.messageId
  const content = args.content

  if (!(await canAccessChatChannel(channelId, userId))) {
    // 404 rather than 403: a channel the caller cannot see should not be
    // confirmed to exist, matching the rest of the chat surface.
    return { ok: false, status: 404, error: 'Channel not found' }
  }

  // The source message must be real and in THIS channel. Without this a caller
  // could hand off an id from a channel they cannot read and have the reply
  // posted where they can.
  const source = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { channelId: true },
  })
  if (!source || source.channelId !== channelId) {
    return { ok: false, status: 404, error: 'Message not found in this channel' }
  }

  // Layer 1 — refuse a retry before spending a model call.
  const existingClaim = await RedisCache.get<string>(claimKey(messageId))
  if (existingClaim) {
    log.info({ messageId }, 'Handoff already claimed; not dispatching again')
    return { ok: true, dispatched: 'none', reason: 'duplicate' }
  }
  await RedisCache.set(claimKey(messageId), userId, CLAIM_TTL_SECONDS)

  // Resolved here rather than in the route: it is a plain lookup with no rule
  // attached, and keeping it out of the route keeps that route free of a direct
  // Prisma import (tests/rules/prisma-in-routes-ratchet.test.ts).
  const sender = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  })
  const userName = sender?.name || 'Someone'

  const channel = await prisma.chatChannel.findUnique({
    where: { id: channelId },
    select: { listId: true },
  })

  const agentId = await resolveDefaultAgent(channel?.listId || null, userId)
  if (!agentId) {
    // No selected agent means nobody to answer. Not an error: the client was
    // right to hand off, there is simply nothing configured.
    return { ok: true, dispatched: 'none', reason: 'no-agent' }
  }

  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { email: true },
  })

  if (agent?.email === ASTRID_EMAIL) {
    // Fire-and-forget, matching the legacy path: generation takes seconds and
    // the client is not waiting on the reply, it is waiting on the handoff
    // being accepted.
    processAstridMessage({
      userMessage: content,
      userId,
      userName,
      channelId,
      listId: channel?.listId || null,
      replyClientRequestId: replyRequestId(messageId),
    }).catch(err => log.error({ err }, `${BRAND.appName} handoff generation failed`))

    return { ok: true, dispatched: 'astrid' }
  }

  // A server-side agent that is not Astrid gets the same chat_mention event it
  // would have received from the legacy auto-response path.
  await broadcastToUsers([agentId], {
    type: 'chat_mention',
    timestamp: new Date().toISOString(),
    data: {
      channelId,
      listId: channel?.listId || null,
      messageId,
      content,
      authorId: userId,
      authorName: userName,
      mentionedAgentId: agentId,
      isDefaultAgent: true,
    },
  })

  return { ok: true, dispatched: 'external-agent' }
}
