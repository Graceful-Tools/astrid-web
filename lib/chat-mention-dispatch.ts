/**
 * Acting on @mentions in a chat message.
 *
 * Legacy `POST /api/chat/channels/:id/messages` did this inline; v1 did not do
 * it at all, so a mention sent from iOS reached nobody. Task 26311472 — Jon:
 * "Check the IOS repo. If it is a bug. The fix if needed." It is a bug, and
 * checking `astrid-ios` is what established which parts of it are.
 *
 * THREE KINDS OF MENTION, and they are NOT equally safe to dispatch from v1:
 *
 *   human           → push notification.        Safe. iOS does nothing with
 *                     these; its only mention notification is driven by a
 *                     COMMENT sse event, not chat. Silently missing today.
 *
 *   external agent  → `chat_mention` SSE.       Safe. iOS parses only
 *                     `@[Astrid]`, so an @mention of any other agent is
 *                     handled by nobody on the v1 path.
 *
 *   Astrid          → server-side response.     NOT safe, and deliberately not
 *                     done here. See below.
 *
 * WHY ASTRID IS EXCLUDED. iOS runs Astrid ON DEVICE: ChatInputView calls
 * OnDeviceAstrid.respondIfNeeded(), which fires on `@[Astrid]` or any message
 * in a personal channel, and POSTs the reply to
 * /api/v1/chat/channels/:id/agent-response. If the server ALSO dispatched
 * Astrid, an iOS user would get two answers to one message. The server cannot
 * tell from the request whether the client is about to answer locally, so
 * adding it here would be trading silence for duplication.
 *
 * That leaves a real remaining gap, recorded rather than guessed at:
 * OnDeviceAstrid.shouldRespond() requires the on-device model to be BOTH the
 * selected agent and available. A user on iOS who has picked a server-side
 * agent gets no response from either side. Closing that needs either a client
 * signal ("I am not handling this") or a decision to make v1 authoritative and
 * have iOS stop responding locally — a product call, not a cleanup.
 */

import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { PushNotificationService } from '@/lib/push-notification-service'
import { createLogger } from '@/lib/logger'
import { ASTRID_EMAIL } from '@/lib/astrid-agent'

const log = createLogger('chat.mention-dispatch')

/** `@[Display Name](user-id)` — the markup the composer emits on both clients. */
const MENTION_PATTERN = /@\[([^\]]+)\]\(([^)]+)\)/g

export interface MentionDispatchArgs {
  content: string | null | undefined
  channelId: string
  messageId: string
  senderId: string
  senderName: string
}

export interface MentionDispatchResult {
  /** True when at least one AI agent was @mentioned — legacy uses this to decide auto-response. */
  agentMentioned: boolean
}

export async function dispatchChatMentions(
  args: MentionDispatchArgs
): Promise<MentionDispatchResult> {
  const { content, channelId, messageId, senderId, senderName } = args
  let agentMentioned = false

  const mentionedIds = new Set<string>()
  let match: RegExpExecArray | null
  const pattern = new RegExp(MENTION_PATTERN.source, 'g')

  while ((match = pattern.exec(content || '')) !== null) {
    const id = match[2]
    // Mentioning yourself notifies nobody. Deduped as well, so `@[X] @[X]`
    // sends one push rather than two.
    if (id !== senderId) mentionedIds.add(id)
  }

  if (mentionedIds.size === 0) return { agentMentioned }

  const users = await prisma.user.findMany({
    where: { id: { in: [...mentionedIds] } },
    select: { id: true, isAIAgent: true, email: true },
  })

  const channel = await prisma.chatChannel.findUnique({
    where: { id: channelId },
    select: { listId: true },
  })

  for (const user of users) {
    if (user.isAIAgent) {
      agentMentioned = true

      // Astrid is handled by the caller (legacy) or by the client (iOS) — see
      // the header. Only EXTERNAL agents are dispatched here.
      if (user.email === ASTRID_EMAIL) continue

      await broadcastToUsers([user.id], {
        type: 'chat_mention',
        timestamp: new Date().toISOString(),
        data: {
          channelId,
          listId: channel?.listId || null,
          messageId,
          content,
          authorId: senderId,
          authorName: senderName,
          mentionedAgentId: user.id,
        },
      })
      continue
    }

    // A failed push must not fail the message that is already saved.
    try {
      const pushService = new PushNotificationService()
      await pushService.sendChatMentionNotification(user.id, {
        channelId,
        messageId,
        senderName,
        content: content || '',
      })
    } catch (pushError) {
      log.error({ err: pushError }, 'Push notification error')
    }
  }

  return { agentMentioned }
}
