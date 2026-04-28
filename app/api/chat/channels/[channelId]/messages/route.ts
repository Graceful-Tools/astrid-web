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
import { createLogger } from '@/lib/logger'

const log = createLogger('chat.channels.[channelId].messages')


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
      include: {
        author: { select: MESSAGE_AUTHOR_SELECT },
        secureFiles: { select: SECURE_FILE_SELECT },
      },
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
    log.error({ err: error }, '[Chat API] GET messages error:')
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
    const { content, type, attachmentUrl, attachmentName, attachmentType, attachmentSize, replyToId, clientRequestId, fileId } = body

    if (!content?.trim() && !attachmentUrl && !fileId) {
      return NextResponse.json({ error: 'Content or attachment is required' }, { status: 400 })
    }

    // Idempotency check
    if (clientRequestId) {
      const existing = await prisma.chatMessage.findUnique({
        where: { clientRequestId },
        include: {
          author: { select: MESSAGE_AUTHOR_SELECT },
          secureFiles: { select: SECURE_FILE_SELECT },
        },
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

    let message = await prisma.chatMessage.create({
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
      include: {
        author: { select: MESSAGE_AUTHOR_SELECT },
        secureFiles: { select: SECURE_FILE_SELECT },
      },
    })

    // Associate secure file if provided
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

        // Refetch message to include the associated file
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
        log.error({ err: error }, '[Chat API] Failed to associate file with message:')
      }
    }

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
            }).catch(err => log.error({ err: err }, '[Chat API] Astrid runtime error:'))
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
            log.error({ err: pushError }, '[Chat API] Push notification error:')
          }
        }
      }

      // If no agent was explicitly @mentioned and sender is not an agent,
      // auto-respond ONLY on personal (non-shared) channels:
      //   - Virtual channels (My Tasks) — no listId, owned by the user
      //   - Private lists owned solely by the user (no other members)
      // On shared lists, the agent must be @mentioned explicitly.
      if (!agentExplicitlyMentioned && !senderIsAgent) {
        try {
          const channel = await prisma.chatChannel.findUnique({
            where: { id: channelId },
            select: { listId: true, virtualKey: true },
          })

          // Determine if this is a personal (non-shared) channel
          let isPersonalChannel = false
          if (channel?.virtualKey) {
            // Virtual channel (My Tasks) — always personal
            isPersonalChannel = true
          } else if (channel?.listId) {
            // List channel — only personal if user is sole owner with no other members
            const list = await prisma.taskList.findUnique({
              where: { id: channel.listId },
              select: {
                ownerId: true,
                privacy: true,
                listMembers: { select: { userId: true } },
              },
            })
            if (list) {
              const isOwner = list.ownerId === auth.userId
              const otherMembers = list.listMembers.filter(m => m.userId !== auth.userId)
              isPersonalChannel = isOwner && otherMembers.length === 0 && list.privacy !== 'PUBLIC'
            }
          }

          if (!isPersonalChannel) {
            // Shared channel — skip auto-response, require @mention
          } else {
          const defaultAgentId = await resolveDefaultAgent(channel?.listId || null, auth.userId)
          log.info(`[Chat API] Default agent resolution: listId=${channel?.listId || 'null'}, userId=${auth.userId}, agentId=${defaultAgentId || 'null'}`)
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
              }).catch(err => log.error({ err: err }, '[Chat API] Astrid default agent error:'))
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
          } // close isPersonalChannel else
        } catch (defaultAgentError) {
          log.error({ err: defaultAgentError }, '[Chat API] Default agent dispatch error:')
        }
      }
    } catch (sseError) {
      log.error({ err: sseError }, '[Chat API] SSE broadcast error:')
      // Don't fail the request if SSE broadcast fails
    }

    return NextResponse.json({ message: serializedMessage }, { status: 201 })
  } catch (error: any) {
    if (error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    log.error({ err: error }, '[Chat API] POST message error:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
