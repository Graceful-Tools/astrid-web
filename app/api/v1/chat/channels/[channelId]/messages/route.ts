/**
 * Chat Messages API v1
 *
 * GET  /api/v1/chat/channels/:channelId/messages — paginated messages
 * POST /api/v1/chat/channels/:channelId/messages — send a message
 */

import { NextResponse } from 'next/server'
import { getDeprecationWarning } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { canAccessChatChannel, getChatChannelRecipients } from '@/lib/chat-access'
import { broadcastToUsers } from '@/lib/sse-utils'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.chat.channels.messages')

const MESSAGE_AUTHOR_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  isAIAgent: true,
  aiAgentType: true,
}

const SECURE_FILE_SELECT = {
  id: true,
  originalName: true,
  mimeType: true,
  fileSize: true,
  createdAt: true,
}

type RouteContext = { params: Promise<{ channelId: string }> }

/**
 * GET /api/v1/chat/channels/:channelId/messages
 * Get paginated messages for a chat channel
 *
 * Query params:
 *   before?: string (ISO date cursor for pagination)
 *   limit?: number (default 50, max 100)
 */
export const GET = withAuth<RouteContext>(
  { scopes: ['chat:read'], tag: 'v1.chat.channels.messages' },
  async (req, auth, { params }) => {
    const { channelId } = await params
    const hasAccess = await canAccessChatChannel(channelId, auth.userId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const url = new URL(req.url)
    const before = url.searchParams.get('before')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100)

    const where: any = { channelId }
    if (before) {
      where.createdAt = { lt: new Date(before) }
    }

    const messages = await prisma.chatMessage.findMany({
      where,
      include: {
        author: { select: MESSAGE_AUTHOR_SELECT },
        secureFiles: { select: SECURE_FILE_SELECT },
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    })

    const hasMore = messages.length > limit
    if (hasMore) messages.pop()

    messages.reverse()

    const nextCursor = hasMore && messages.length > 0
      ? messages[0].createdAt.toISOString()
      : null

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        messages: messages.map(m => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
        })),
        hasMore,
        nextCursor,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { headers }
    )
  }
)

/**
 * POST /api/v1/chat/channels/:channelId/messages
 * Send a message to a chat channel
 *
 * Body:
 * {
 *   content: string (required unless fileId provided)
 *   type?: 'TEXT' | 'MARKDOWN' | 'ATTACHMENT'
 *   fileId?: string (SecureFile ID to attach)
 *   replyToId?: string (for threaded replies)
 *   clientRequestId?: string (for idempotency)
 * }
 */
export const POST = withAuth<RouteContext>(
  { scopes: ['chat:write'], tag: 'v1.chat.channels.messages' },
  async (req, auth, { params }) => {
    const { channelId } = await params
    const hasAccess = await canAccessChatChannel(channelId, auth.userId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { content, type, fileId, replyToId, clientRequestId } = body

    if (!content?.trim() && !fileId) {
      return NextResponse.json({ error: 'Content or file attachment is required' }, { status: 400 })
    }

    if (clientRequestId) {
      const existing = await prisma.chatMessage.findUnique({
        where: { clientRequestId },
        include: {
          author: { select: MESSAGE_AUTHOR_SELECT },
          secureFiles: { select: SECURE_FILE_SELECT },
        },
      })
      if (existing) {
        log.info({ messageId: existing.id }, 'Idempotency hit (clientRequestId): returning existing chat message')
        return NextResponse.json({
          message: {
            ...existing,
            createdAt: existing.createdAt.toISOString(),
            updatedAt: existing.updatedAt.toISOString(),
          },
        })
      }
    }

    let message = await prisma.chatMessage.create({
      data: {
        channelId,
        authorId: auth.userId,
        content: content?.trim() || '',
        type: type || 'TEXT',
        replyToId,
        clientRequestId,
      },
      include: {
        author: { select: MESSAGE_AUTHOR_SELECT },
        secureFiles: { select: SECURE_FILE_SELECT },
      },
    })

    if (fileId) {
      try {
        await prisma.secureFile.update({
          where: {
            id: fileId,
            uploadedBy: auth.userId,
          },
          data: {
            chatMessageId: message.id,
          },
        })

        const updatedMessage = await prisma.chatMessage.findUnique({
          where: { id: message.id },
          include: {
            author: { select: MESSAGE_AUTHOR_SELECT },
            secureFiles: { select: SECURE_FILE_SELECT },
          },
        })

        if (updatedMessage) {
          message = updatedMessage
        }
      } catch (error) {
        log.error({ err: error, fileId }, 'Failed to associate file with chat message')
      }
    }

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
      log.error({ err: sseError }, 'Failed to broadcast chat_message_created')
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: serializedMessage,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { status: 201, headers }
    )
  }
)
