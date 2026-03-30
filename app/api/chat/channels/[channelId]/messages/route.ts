/**
 * Chat Messages API
 *
 * GET  /api/chat/channels/[channelId]/messages — paginated messages
 * POST /api/chat/channels/[channelId]/messages — send a message
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { canAccessChatChannel, getChatChannelRecipients } from '@/lib/chat-access'
import { broadcastToUsers } from '@/lib/sse-utils'
import { PushNotificationService } from '@/lib/push-notification-service'
import { resolveDefaultAgent } from '@/lib/resolve-default-agent'
import { processAstridMessage } from '@/lib/astrid-agent-runtime'
import { ASTRID_EMAIL } from '@/lib/astrid-agent'

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
    const auth = await authenticateAPI(req)

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
  } catch (error: any) {
    if (error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[Chat API] GET messages error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const auth = await authenticateAPI(req)

    const { channelId } = await params
    const hasAccess = await canAccessChatChannel(channelId, auth.userId)
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
        authorId: auth.userId,
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

      // Parse @mentions and notify users
      const mentionPattern = /@\[([^\]]+)\]\(([^)]+)\)/g
      let match
      const senderName = message.author.name || message.author.email || 'Someone'
      let agentExplicitlyMentioned = false
      const senderIsAgent = message.author.isAIAgent

      while ((match = mentionPattern.exec(content || '')) !== null) {
        const mentionedUserId = match[2]
        if (mentionedUserId === auth.userId) continue // Don't notify self

        const mentionedUser = await prisma.user.findUnique({
          where: { id: mentionedUserId },
          select: { id: true, isAIAgent: true, email: true },
        })

        if (!mentionedUser) continue

        if (mentionedUser.isAIAgent) {
          agentExplicitlyMentioned = true

          const channel = await prisma.chatChannel.findUnique({
            where: { id: channelId },
            select: { listId: true },
          })

          // If this is Astrid, use the built-in runtime to respond directly
          if (mentionedUser.email === ASTRID_EMAIL) {
            processAstridMessage({
              userMessage: content || '',
              userId: auth.userId,
              userName: senderName,
              channelId,
              listId: channel?.listId || null,
            }).catch(err => console.error('[Chat API] Astrid runtime error:', err))
          } else {
            // Other AI agents — send chat_mention SSE event for external processing
            await broadcastToUsers([mentionedUserId], {
              type: 'chat_mention',
              timestamp: new Date().toISOString(),
              data: {
                channelId,
                listId: channel?.listId || null,
                messageId: message.id,
                content: content,
                authorId: auth.userId,
                authorName: senderName,
                mentionedAgentId: mentionedUserId,
              },
            })
          }
        } else {
          // Human user — send push notification
          try {
            const pushService = new PushNotificationService()
            await pushService.sendChatMentionNotification(mentionedUserId, {
              channelId,
              messageId: message.id,
              senderName,
              content: content || '',
            })
          } catch (pushError) {
            console.error('[Chat API] Push notification error:', pushError)
          }
        }
      }

      // If no agent was explicitly @mentioned and sender is not an agent,
      // check for a default agent assigned to this list/user
      if (!agentExplicitlyMentioned && !senderIsAgent) {
        try {
          const channel = await prisma.chatChannel.findUnique({
            where: { id: channelId },
            select: { listId: true },
          })

          const defaultAgentId = await resolveDefaultAgent(channel?.listId || null, auth.userId)
          if (defaultAgentId) {
            // Check if the default agent is Astrid
            const defaultAgent = await prisma.user.findUnique({
              where: { id: defaultAgentId },
              select: { email: true },
            })

            if (defaultAgent?.email === ASTRID_EMAIL) {
              // Use Astrid runtime to respond directly
              processAstridMessage({
                userMessage: content || '',
                userId: auth.userId,
                userName: senderName,
                channelId,
                listId: channel?.listId || null,
              }).catch(err => console.error('[Chat API] Astrid default agent error:', err))
            } else {
              // External agent — send SSE event
              await broadcastToUsers([defaultAgentId], {
                type: 'chat_mention',
                timestamp: new Date().toISOString(),
                data: {
                  channelId,
                  listId: channel?.listId || null,
                  messageId: message.id,
                  content: content,
                  authorId: auth.userId,
                  authorName: senderName,
                  mentionedAgentId: defaultAgentId,
                  isDefaultAgent: true,
                },
              })
            }
          }
        } catch (defaultAgentError) {
          console.error('[Chat API] Default agent dispatch error:', defaultAgentError)
        }
      }
    } catch (sseError) {
      console.error('[Chat API] SSE broadcast error:', sseError)
      // Don't fail the request if SSE broadcast fails
    }

    return NextResponse.json({ message: serializedMessage }, { status: 201 })
  } catch (error: any) {
    if (error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[Chat API] POST message error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
