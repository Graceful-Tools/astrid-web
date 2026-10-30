/**
 * API Key Cache for AI Services
 * Securely retrieves and caches API keys for AI orchestration
 */

import { decryptCredential, type EncryptedCredential } from '@/lib/ai/credential-cipher'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { BRAND_ASSISTANT_SERVICE, type AIService } from '@/lib/ai/agent-config'

const log = createLogger('api-key-cache')


// Cache to avoid repeated database queries
const apiKeyCache = new Map<string, { key: string; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Get cached API key for a user and AI service
 */
export async function getCachedApiKey(
  userId: string,
  service: AIService
): Promise<string | null> {
  try {
    const cacheKey = `${userId}-${service}`
    const cached = apiKeyCache.get(cacheKey)

    // Return cached key if still valid
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.key
    }

    // Fetch from database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mcpSettings: true }
    })

    if (!user?.mcpSettings) {
      return null
    }

    // Parse mcpSettings properly (could be string or already parsed object)
    let settings: any = {}
    try {
      settings = typeof user.mcpSettings === 'string'
        ? JSON.parse(user.mcpSettings)
        : user.mcpSettings
    } catch (error) {
      log.error({ err: error }, 'Failed to parse mcpSettings in getCachedApiKey:')
      return null
    }

    // Use standard apiKeys location
    const apiKeys = settings.apiKeys || {}
    const encryptedKey = apiKeys[service]

    if (!encryptedKey) {
      return null
    }

    // The same cipher that wrote it (AWTD-1380): GCM since 2026-07-05, legacy
    // CBC before. A private CBC-only decrypt here used to fail every GCM key,
    // so any credential saved since then read as absent.
    try {
      const decryptedKey = decryptCredential(encryptedKey as EncryptedCredential)

      // Cache the decrypted key
      apiKeyCache.set(cacheKey, {
        key: decryptedKey,
        timestamp: Date.now()
      })

      return decryptedKey
    } catch (decryptError) {
      log.error({ err: decryptError }, `Error getting ${service} API key for user ${userId}:`)
      log.info(`💡 [API Key Cache] The ${service} API key was encrypted with a different encryption key. Please re-enter your ${service} API key in Settings → AI Agents to fix this.`)
      return null
    }

  } catch (error) {
    log.error({ err: error }, `Error getting ${service} API key for user ${userId}:`)
    return null
  }
}

/**
 * Return the credential used to invoke an AI service.
 *
 * Copilot resolves through copilotTokenFor, which prefers a connected GitHub
 * OAuth account and falls back to a token the user pasted into settings.
 *
 * This previously routed to OAuth only, on the assumption that pasted Copilot
 * tokens were invalid. That assumption was wrong: Copilot entitlement follows
 * the user's Copilot subscription, not the OAuth app that minted the token, so
 * an ordinary GitHub token authenticates fine (verified live against
 * api.githubcopilot.com). OAuth remains preferred — it is revocable and
 * refreshable — but requiring it made Copilot unusable on any server without a
 * registered GitHub OAuth App.
 */
export async function getAIServiceCredential(
  userId: string,
  service: AIService
): Promise<string | null> {
  if (service === 'copilot') {
    const { copilotTokenFor } = await import('@/lib/copilot/oauth')
    return copilotTokenFor(userId)
  }
  return getCachedApiKey(userId, service)
}


/**
 * Clear cache for a user (useful when keys are updated)
 */
export function clearApiKeyCache(userId: string): void {
  const services = ['claude', 'openai', 'gemini', 'muse', 'openclaw']
  services.forEach(service => {
    apiKeyCache.delete(`${userId}-${service}`)
  })
}

/**
 * Check if user has a valid API key for the service
 */
export async function hasValidApiKey(
  userId: string,
  service: AIService
): Promise<boolean> {
  try {
    const key = await getAIServiceCredential(userId, service)
    return key !== null && key.length > 0
  } catch (error) {
    // If we can't get the API key (e.g., decryption failed), it's not valid
    return false
  }
}

/**
 * Get cached model preference for a user and AI service
 */
export async function getCachedModelPreference(
  userId: string,
  service: AIService
): Promise<string | null> {
  try {
    // Fetch from database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { mcpSettings: true }
    })

    if (!user?.mcpSettings) {
      return null
    }

    // Parse mcpSettings properly
    let settings: any = {}
    try {
      settings = typeof user.mcpSettings === 'string'
        ? JSON.parse(user.mcpSettings)
        : user.mcpSettings
    } catch (error) {
      log.error({ err: error }, 'Failed to parse mcpSettings in getCachedModelPreference:')
      return null
    }

    // Get model preference
    const modelPreferences = settings.modelPreferences || {}
    return modelPreferences[service] || null
  } catch (error) {
    log.error({ err: error }, `Error getting ${service} model preference for user ${userId}:`)
    return null
  }
}

/**
 * Get the user's preferred AI service (with fallback)
 *
 * Every fallback is the brand's assistant provider (BRAND_ASSISTANT_SERVICE,
 * AWTD-1056) — Claude unless a white label chose otherwise.
 */
export async function getPreferredAIService(userId: string): Promise<AIService> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { aiAssistantSettings: true }
    })

    if (!user?.aiAssistantSettings) {
      return BRAND_ASSISTANT_SERVICE // Default fallback
    }

    const settings = JSON.parse(user.aiAssistantSettings)

    // Check user's preferred service from settings
    if (settings.preferredService) {
      return settings.preferredService
    }

    // Fallback: return the first service that has an API key, the brand's own first
    // Note: openclaw uses gateway URLs, not API keys, so it's not included here
    // Muse (AWTD-1053) is one more keyed provider; the brand's own comes first (AWTD-1056).
    const services: AIService[] = [
      BRAND_ASSISTANT_SERVICE,
      ...(['claude', 'openai', 'gemini', 'copilot', 'muse'] as const).filter((s) => s !== BRAND_ASSISTANT_SERVICE),
    ]

    for (const service of services) {
      if (await hasValidApiKey(userId, service)) {
        return service
      }
    }

    return BRAND_ASSISTANT_SERVICE // Final fallback

  } catch (error) {
    log.error({ err: error }, 'Error getting preferred AI service:')
    return BRAND_ASSISTANT_SERVICE
  }
}
