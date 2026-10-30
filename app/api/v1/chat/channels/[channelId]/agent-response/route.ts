/**
 * On-Device Agent Response API
 *
 * POST /api/v1/chat/channels/{channelId}/agent-response (moved from the legacy
 * path this route used to re-export, AWTD-839)
 *
 * Allows iOS clients with on-device AI models (e.g. Apple Foundation Models)
 * to post responses as Astrid after processing locally. The message is
 * attributed to Astrid and broadcast to channel recipients via SSE.
 * Authenticated through withAuth with chat:write, like the sibling
 * astrid-response route (AWTD-1402).
 */

import { BRAND } from '@/lib/brand/config'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { broadcastToUsers } from '@/lib/sse-utils'
import { ASTRID_EMAIL } from '@/lib/astrid-agent'
import { AIAssistantSettingsSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'
import { ON_DEVICE_MODEL_IDS } from '@/lib/ai/agent-config'

type RouteContext = { params: Promise<{ channelId: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['chat:write'], tag: 'v1.chat.channels.agent-response' },
  async (req, auth, { params }) => {
    const { channelId } = await params
    const { content } = await req.json()

    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'content is required' }, { status: 400 })
    }

    // Verify user has on-device model selected
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { aiAssistantSettings: true },
    })
    const settings = parseUserAIConfig(
      user?.aiAssistantSettings,
      AIAssistantSettingsSchema,
      'chat/channels/agent-response'
    )
    if (!settings.defaultAgentId || !(ON_DEVICE_MODEL_IDS as readonly string[]).includes(settings.defaultAgentId)) {
      return NextResponse.json({ error: 'On-device model not configured' }, { status: 403 })
    }

    // Verify channel access
    const { getChatChannelRecipients } = await import('@/lib/chat-access')
    const recipients = await getChatChannelRecipients(channelId)
    if (!recipients.includes(auth.userId)) {
      return NextResponse.json({ error: 'Not a member of this channel' }, { status: 403 })
    }

    // Get Astrid agent user
    const astridUser = await prisma.user.findFirst({
      where: { email: ASTRID_EMAIL },
      select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true },
    })
    if (!astridUser) {
      return NextResponse.json({ error: `${BRAND.appName} agent not found` }, { status: 500 })
    }

    // Create message as Astrid
    const message = await prisma.chatMessage.create({
      data: {
        channelId,
        authorId: astridUser.id,
        content,
        type: 'MARKDOWN',
      },
      include: {
        author: { select: { id: true, name: true, email: true, image: true, isAIAgent: true, aiAgentType: true } },
      },
    })

    // Broadcast to channel recipients
    const otherRecipients = recipients.filter(id => id !== astridUser.id)
    if (otherRecipients.length > 0) {
      const serialized = {
        ...message,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
      }
      await broadcastToUsers(otherRecipients, {
        type: 'chat_message_created',
        timestamp: new Date().toISOString(),
        data: { channelId, message: serialized },
      })
    }

    return NextResponse.json({
      message: {
        ...message,
        createdAt: message.createdAt.toISOString(),
        updatedAt: message.updatedAt.toISOString(),
      },
    }, { status: 201 })
  }
)
