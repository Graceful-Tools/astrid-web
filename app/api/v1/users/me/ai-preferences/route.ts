/**
 * GET/PATCH /api/v1/users/me/ai-preferences
 *
 * AI assistant preferences: preferredService, defaultAgentId.
 * Mirrors GET/PATCH /api/user/ai-assistant-settings.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { ON_DEVICE_MODEL_IDS } from '@/lib/ai/agent-config'
import { AIAssistantSettingsSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.ai-preferences')

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.ai-preferences' },
  async (_req, auth) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { aiAssistantSettings: true },
      })
      const settings = parseUserAIConfig(
        user?.aiAssistantSettings,
        AIAssistantSettingsSchema,
        'v1.ai-preferences GET'
      )
      return NextResponse.json({
        preferredService: settings.preferredService || null,
        defaultAgentId: settings.defaultAgentId || null,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching ai-preferences')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const PATCH = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.ai-preferences' },
  async (req, auth) => {
    try {
      const body = await req.json()
      const { defaultAgentId, preferredService } = body

      if (defaultAgentId && !(ON_DEVICE_MODEL_IDS as readonly string[]).includes(defaultAgentId)) {
        const agent = await prisma.user.findUnique({
          where: { id: defaultAgentId },
          select: { id: true, isAIAgent: true },
        })
        if (!agent?.isAIAgent) {
          return NextResponse.json({ error: 'Invalid agent' }, { status: 400 })
        }
      }

      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { aiAssistantSettings: true },
      })
      const existing = parseUserAIConfig(
        user?.aiAssistantSettings,
        AIAssistantSettingsSchema,
        'v1.ai-preferences PATCH'
      )
      const updated: Record<string, unknown> = { ...existing }
      if ('defaultAgentId' in body) updated.defaultAgentId = defaultAgentId || null
      if ('preferredService' in body) updated.preferredService = preferredService || null

      await prisma.user.update({
        where: { id: auth.userId },
        data: { aiAssistantSettings: JSON.stringify(updated) },
      })

      return NextResponse.json({
        preferredService: updated.preferredService || null,
        defaultAgentId: updated.defaultAgentId || null,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error updating ai-preferences')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
