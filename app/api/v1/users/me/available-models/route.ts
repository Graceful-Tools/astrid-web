/**
 * GET /api/v1/users/me/available-models?service=claude|openai|gemini
 *
 * Lists available models for an AI provider, using the user's stored
 * API key for the live fetch. Falls back to static suggestions if no
 * key is configured. Mirrors GET /api/user/ai-available-models.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { getCachedApiKey } from '@/lib/api-key-cache'
import { fetchProviderModels } from '@/lib/ai/fetch-provider-models'
import { SUGGESTED_MODELS, type AIService } from '@/lib/ai/agent-config'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.available-models')

const VALID_SERVICES = ['claude', 'openai', 'gemini'] as const

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.available-models' },
  async (req, auth) => {
    try {
      const service = new URL(req.url).searchParams.get('service') as
        typeof VALID_SERVICES[number] | null
      if (!service || !VALID_SERVICES.includes(service)) {
        return NextResponse.json(
          { error: 'Invalid service. Use: claude, openai, gemini' },
          { status: 400 }
        )
      }

      const apiKey = await getCachedApiKey(auth.userId, service)
      if (!apiKey) {
        return NextResponse.json({
          models: SUGGESTED_MODELS[service as AIService] || [],
          source: 'static',
          meta: { apiVersion: 'v1' as const, authSource: auth.source },
        })
      }

      const liveModels = await fetchProviderModels(service, apiKey)
      if (liveModels.length > 0) {
        return NextResponse.json({
          models: liveModels,
          source: 'live',
          meta: { apiVersion: 'v1' as const, authSource: auth.source },
        })
      }

      return NextResponse.json({
        models: SUGGESTED_MODELS[service as AIService] || [],
        source: 'static',
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching available models')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
