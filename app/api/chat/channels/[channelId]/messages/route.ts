/**
 * Chat Messages API
 *
 * GET  /api/chat/channels/[channelId]/messages — paginated messages
 * POST /api/chat/channels/[channelId]/messages — send a message
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
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

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { channelId } = await params
    const hasAccess = await canAccessChatChannel(channelId, session.user.id)
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
      include: { author: { select: MESSAGE_AUTHOR_SELECT } },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    })

    const hasMore = messages.length > limit
    if (hasMore) messages.pop()

    // Reverse to chronological order for the client
    messages.reverse()

    const nextCursor = hasMore && messages.length > 0
      ? messages[0].createdAt.toISOString()
      : null

    return NextResponse.json({
      messages: messages.map(m => ({
        ...m,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      })),
      hasMore,
      nextCursor,
    })
  } catch (error) {
    console.error('[Chat API] GET messages error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { channelId } = await params
    const hasAccess = await canAccessChatChannel(channelId, session.user.id)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json()
    const { content, type, attachmentUrl, attachmentName, attachmentType, attachmentSize, replyToId, clientRequestId } = body

    if (!content?.trim() && !attachmentUrl) {
      return NextResponse.json({ error: 'Content or attachment is required' }, { status: 400 })
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
        authorId: session.user.id,
        content: content?.trim() || '',
        type: type || 'TEXT',
        attachmentUrl,
        attachmentName,
        attachmentType,
        attachmentSize,
        replyToId,
        clientRequestId,
      },
      include: { author: { select: MESSAGE_AUTHOR_SELECT } },
    })

    const serializedMessage = {
      ...message,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    }

    // Broadcast to all channel members
    try {
      const recipientIds = await getChatChannelRecipients(channelId)
      // Don't broadcast to the sender (they have optimistic update)
      const otherRecipients = recipientIds.filter(id => id !== session.user.id)

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

      // Parse @mentions and notify AI agents
      const mentionPattern = /@\[([^\]]+)\]\(([^)]+)\)/g
      let match
      while ((match = mentionPattern.exec(content || '')) !== null) {
        const mentionedUserId = match[2]
        // Check if mentioned user is an AI agent
        const mentionedUser = await prisma.user.findUnique({
          where: { id: mentionedUserId },
          select: { id: true, isAIAgent: true },
        })

        if (mentionedUser?.isAIAgent) {
          // Get channel's listId for context
          const channel = await prisma.chatChannel.findUnique({
            where: { id: channelId },
            select: { listId: true },
          })

          await broadcastToUsers([mentionedUserId], {
            type: 'chat_mention',
            timestamp: new Date().toISOString(),
            data: {
              channelId,
              listId: channel?.listId || null,
              messageId: message.id,
              content: content,
              authorId: session.user.id,
              authorName: message.author.name || message.author.email,
              mentionedAgentId: mentionedUserId,
            },
          })
        }
      }
    } catch (sseError) {
      console.error('[Chat API] SSE broadcast error:', sseError)
      // Don't fail the request if SSE broadcast fails
    }

    return NextResponse.json({ message: serializedMessage }, { status: 201 })
  } catch (error) {
    console.error('[Chat API] POST message error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
