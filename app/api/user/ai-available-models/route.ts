/**
 * Available AI Models API
 *
 * GET /api/user/ai-available-models?service=claude
 *
 * Fetches available models from the provider API using the user's stored API key.
 * Results are cached server-side for 1 hour.
 */

import { type NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { getCachedApiKey } from '@/lib/api-key-cache'
import { fetchProviderModels } from '@/lib/ai/fetch-provider-models'
import { SUGGESTED_MODELS, type AIService } from '@/lib/ai/agent-config'

const VALID_SERVICES = ['claude', 'openai', 'gemini'] as const

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const service = request.nextUrl.searchParams.get('service') as typeof VALID_SERVICES[number] | null
    if (!service || !VALID_SERVICES.includes(service)) {
      return NextResponse.json({ error: 'Invalid service. Use: claude, openai, gemini' }, { status: 400 })
    }

    // Get user's API key for this service
    const apiKey = await getCachedApiKey(session.user.id, service)
    if (!apiKey) {
      // No API key — return static suggestions only
      return NextResponse.json({
        models: SUGGESTED_MODELS[service as AIService] || [],
        source: 'static',
      })
    }

    // Fetch live models from provider
    const liveModels = await fetchProviderModels(service, apiKey)

    if (liveModels.length > 0) {
      return NextResponse.json({
        models: liveModels,
        source: 'live',
      })
    }

    // Fallback to static if API call failed
    return NextResponse.json({
      models: SUGGESTED_MODELS[service as AIService] || [],
      source: 'static',
    })
  } catch (error) {
    console.error('[AI Available Models] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
