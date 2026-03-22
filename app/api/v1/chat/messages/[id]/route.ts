/**
 * Individual Chat Message API v1
 *
 * GET    /api/v1/chat/messages/:id — get a single message
 * PUT    /api/v1/chat/messages/:id — update a message
 * DELETE /api/v1/chat/messages/:id — delete a message
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, requireScopes, getDeprecationWarning, UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
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

const SECURE_FILE_SELECT = {
  id: true,
  originalName: true,
  mimeType: true,
  fileSize: true,
  createdAt: true,
}

/**
 * GET /api/v1/chat/messages/:id
 * Get a single chat message by ID
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['chat:read'])

    const { id } = await params

    const message = await prisma.chatMessage.findUnique({
      where: { id },
      include: {
        author: { select: MESSAGE_AUTHOR_SELECT },
        secureFiles: { select: SECURE_FILE_SELECT },
      },
    })

    if (!message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Verify channel access
    const hasAccess = await canAccessChatChannel(message.channelId, auth.userId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: {
          ...message,
          createdAt: message.createdAt.toISOString(),
          updatedAt: message.updatedAt.toISOString(),
        },
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 })
    }
    console.error('[API v1] GET /chat/messages/:id error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * PUT /api/v1/chat/messages/:id
 * Update a chat message (only the author can update)
 *
 * Body:
 * {
 *   content: string (required)
 * }
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['chat:write'])

    const { id } = await params
    const body = await req.json()

    if (!body.content || typeof body.content !== 'string') {
      return NextResponse.json(
        { error: 'content is required and must be a string' },
        { status: 400 }
      )
    }

    const existingMessage = await prisma.chatMessage.findUnique({
      where: { id },
      select: { authorId: true, channelId: true },
    })

    if (!existingMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Verify channel access
    const hasAccess = await canAccessChatChannel(existingMessage.channelId, auth.userId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Only author can update their own message
    if (existingMessage.authorId !== auth.userId) {
      return NextResponse.json(
        { error: 'You can only edit your own messages' },
        { status: 403 }
      )
    }

    const message = await prisma.chatMessage.update({
      where: { id },
      data: {
        content: body.content.trim(),
        updatedAt: new Date(),
      },
      include: {
        author: { select: MESSAGE_AUTHOR_SELECT },
        secureFiles: { select: SECURE_FILE_SELECT },
      },
    })

    const serializedMessage = {
      ...message,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
    }

    // Broadcast update
    try {
      const recipientIds = await getChatChannelRecipients(existingMessage.channelId)
      const otherRecipients = recipientIds.filter(rid => rid !== auth.userId)

      if (otherRecipients.length > 0) {
        await broadcastToUsers(otherRecipients, {
          type: 'chat_message_updated',
          timestamp: new Date().toISOString(),
          data: {
            channelId: existingMessage.channelId,
            message: serializedMessage,
          },
        })
      }
    } catch (sseError) {
      console.error('[API v1] SSE broadcast error:', sseError)
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        message: serializedMessage,
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 })
    }
    console.error('[API v1] PUT /chat/messages/:id error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/chat/messages/:id
 * Delete a chat message (author or list owner/admin can delete)
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authenticateAPI(req)
    requireScopes(auth, ['chat:write'])

    const { id } = await params

    const existingMessage = await prisma.chatMessage.findUnique({
      where: { id },
      include: {
        channel: {
          include: {
            list: {
              include: {
                listMembers: {
                  select: { userId: true, role: true },
                },
              },
            },
          },
        },
      },
    })

    if (!existingMessage) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Verify channel access
    const hasAccess = await canAccessChatChannel(existingMessage.channelId, auth.userId)
    if (!hasAccess) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }

    // Check permissions: message author, list owner, or list admin can delete
    const isAuthor = existingMessage.authorId === auth.userId
    const isListOwner = existingMessage.channel.list?.ownerId === auth.userId
    const isListAdmin = existingMessage.channel.list?.listMembers?.some(
      m => m.userId === auth.userId && m.role === 'admin'
    )

    if (!isAuthor && !isListOwner && !isListAdmin) {
      return NextResponse.json(
        { error: 'You can only delete your own messages or messages in lists you manage' },
        { status: 403 }
      )
    }

    await prisma.chatMessage.delete({
      where: { id },
    })

    // Broadcast deletion
    try {
      const recipientIds = await getChatChannelRecipients(existingMessage.channelId)
      const otherRecipients = recipientIds.filter(rid => rid !== auth.userId)

      if (otherRecipients.length > 0) {
        await broadcastToUsers(otherRecipients, {
          type: 'chat_message_deleted',
          timestamp: new Date().toISOString(),
          data: {
            channelId: existingMessage.channelId,
            messageId: id,
          },
        })
      }
    } catch (sseError) {
      console.error('[API v1] SSE broadcast error:', sseError)
    }

    const headers: Record<string, string> = {}
    const deprecationWarning = getDeprecationWarning(auth)
    if (deprecationWarning) {
      headers['X-Deprecation-Warning'] = deprecationWarning
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Message deleted successfully',
        meta: {
          apiVersion: 'v1',
          authSource: auth.source,
        },
      },
      { headers }
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 })
    }
    console.error('[API v1] DELETE /chat/messages/:id error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
