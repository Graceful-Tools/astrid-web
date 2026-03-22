/**
 * Agent Chat Messages API
 *
 * POST /api/v1/agent/chat/[channelId]/messages — agent sends a chat message
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAgentRequest } from '@/lib/agent-protocol'
import { UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { canAccessChatChannel, getChatChannelRecipients } from '@/lib/chat-access'
import { broadcastToUsers } from '@/lib/sse-utils'

const MESSAGE_AUTHOR_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
  aiAgentType: true,
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const auth = await authenticateAgentRequest(req, ['chat:write'])

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

    // Idempotency check
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

    // Broadcast to all channel members (except the agent itself)
    try {
      const recipientIds = await getChatChannelRecipients(channelId)
      const otherRecipients = recipientIds.filter(id => id !== auth.userId)

      if (otherRecipients.length > 0) {
        await broadcastToUsers(otherRecipients, {
          type: 'chat_message_created',
          timestamp: new Date().toISOString(),
          data: {
            channelId,
            message: serializedMessage,
          },
        })
      }
    } catch (sseError) {
      console.error('[Agent Chat API] SSE broadcast error:', sseError)
    }

    return NextResponse.json({ message: serializedMessage }, { status: 201 })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 })
    }
    console.error('[Agent Chat API] POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
