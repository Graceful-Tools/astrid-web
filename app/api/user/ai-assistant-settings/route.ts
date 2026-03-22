/**
 * User AI Assistant Settings API
 *
 * GET  /api/user/ai-assistant-settings — get current settings
 * PATCH /api/user/ai-assistant-settings — update settings (merge)
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)

    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { aiAssistantSettings: true },
    })

    const settings = user?.aiAssistantSettings
      ? JSON.parse(user.aiAssistantSettings)
      : {}

    return NextResponse.json({
      preferredService: settings.preferredService || null,
      defaultAgentId: settings.defaultAgentId || null,
    })
  } catch (error: any) {
    if (error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[AI Assistant Settings] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)

    const body = await req.json()
    const { defaultAgentId, preferredService } = body

    // Validate agent if provided
    if (defaultAgentId) {
      const agent = await prisma.user.findUnique({
        where: { id: defaultAgentId },
        select: { id: true, isAIAgent: true },
      })
      if (!agent?.isAIAgent) {
        return NextResponse.json({ error: 'Invalid agent' }, { status: 400 })
      }
    }

    // Merge with existing settings
    const user = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { aiAssistantSettings: true },
    })

    const existing = user?.aiAssistantSettings
      ? JSON.parse(user.aiAssistantSettings)
      : {}

    const updated = { ...existing }
    if ('defaultAgentId' in body) {
      updated.defaultAgentId = defaultAgentId || null
    }
    if ('preferredService' in body) {
      updated.preferredService = preferredService || null
    }

    await prisma.user.update({
      where: { id: auth.userId },
      data: { aiAssistantSettings: JSON.stringify(updated) },
    })

    return NextResponse.json({
      preferredService: updated.preferredService || null,
      defaultAgentId: updated.defaultAgentId || null,
    })
  } catch (error: any) {
    if (error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[AI Assistant Settings] PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
