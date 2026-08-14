/**
 * Agent Chat Messages API
 *
 * POST /api/v1/agent/chat/[channelId]/messages — agent sends a chat message
 */

import { NextResponse } from 'next/server'
import {
  isV1CommentType,
  V1_COMMENT_TYPE_VALUES,
} from '@/lib/api-contracts/v1-request-shapes'
import { prisma } from '@/lib/prisma'
import { canAccessChatChannel, getChatChannelRecipients } from '@/lib/chat-access'
import { broadcastToUsers } from '@/lib/sse-utils'
import { withAgentAuth } from '@/lib/api-agent-auth-wrapper'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.agent.chat.messages')

const MESSAGE_AUTHOR_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
  aiAgentType: true,
}

type RouteContext = { params: Promise<{ channelId: string }> }

export const POST = withAgentAuth<RouteContext>(
  { requiredScopes: ['chat:write'], tag: 'v1.agent.chat.messages' },
  async (req, auth, { params }) => {
    const { channelId } = await params
    const hasAccess = await canAccessChatChannel(channelId, auth.userId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { content, type, clientRequestId } = body

    if (!content?.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    // ChatMessage.type is the same Postgres CommentType enum as Comment.type.
    // Unvalidated, an unknown label reached the Prisma driver and surfaced as a
    // 500 where the caller deserved a 400 — third instance of this shape, after
    // list `privacy` and comment `type`. The enum is case-sensitive, so "text"
    // fails like a typo. (Task 87e19910.)
    if (type !== undefined && !isV1CommentType(type)) {
      return NextResponse.json(
        { error: `type must be one of: ${V1_COMMENT_TYPE_VALUES.join(', ')}` },
        { status: 400 }
      )
    }

    if (clientRequestId) {
      const existing = await prisma.chatMessage.findUnique({
        where: { clientRequestId },
        include: { author: { select: MESSAGE_AUTHOR_SELECT } },
      })
      if (existing) {
        return NextResponse.json({
          message: {
            ...existing,
            createdAt: existing.createdAt.toISOString(),
            updatedAt: existing.updatedAt.toISOString(),
          },
        })
      }
    }

    const message = await prisma.chatMessage.create({
      data: {
        channelId,
        authorId: auth.userId,
        content: content.trim(),
        type: type || 'MARKDOWN',
        clientRequestId,
      },
      include: { author: { select: MESSAGE_AUTHOR_SELECT } },
    })

    const serializedMessage = {
      ...message,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    }

    try {
      const recipientIds = await getChatChannelRecipients(channelId)
      const otherRecipients = recipientIds.filter(id => id !== auth.userId)

      if (otherRecipients.length > 0) {
        await broadcastToUsers(otherRecipients, {
          type: 'chat_message_created',
          timestamp: new Date().toISOString(),
          data: { channelId, message: serializedMessage },
        })
      }
    } catch (sseError) {
      log.error({ err: sseError }, 'SSE broadcast error')
    }

    return NextResponse.json({ message: serializedMessage }, { status: 201 })
  }
)
