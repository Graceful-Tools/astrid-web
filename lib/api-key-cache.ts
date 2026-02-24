/**
 * API Key Cache for AI Services
 * Securely retrieves and caches API keys for AI orchestration
 */

import CryptoJS from 'crypto-js'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

// Cache to avoid repeated database queries
const apiKeyCache = new Map<string, { key: string; timestamp: number }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Get cached API key for a user and AI service
 */
export async function getCachedApiKey(
  userId: string,
  service: 'claude' | 'openai' | 'gemini' | 'openclaw'
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
      console.error('Failed to parse mcpSettings in getCachedApiKey:', error)
      return null
    }

    // Use standard apiKeys location
    const apiKeys = settings.apiKeys || {}
    const encryptedKey = apiKeys[service]

    if (!encryptedKey) {
      return null
    }

    // Decrypt the API key (new format)
    try {
      const decryptedKey = decryptApiKeyNew(encryptedKey)

      // Cache the decrypted key
      apiKeyCache.set(cacheKey, {
        key: decryptedKey,
        timestamp: Date.now()
      })

      return decryptedKey
    } catch (decryptError) {
      console.error(`Error getting ${service} API key for user ${userId}:`, decryptError)
      console.log(`💡 [API Key Cache] The ${service} API key was encrypted with a different encryption key. Please re-enter your ${service} API key in Settings → AI Agents to fix this.`)
      return null
    }

  } catch (error) {
    console.error(`Error getting ${service} API key for user ${userId}:`, error)
    return null
  }
}


/**
 * Clear cache for a user (useful when keys are updated)
 */
export function clearApiKeyCache(userId: string): void {
  const services = ['claude', 'openai', 'gemini']
  services.forEach(service => {
    apiKeyCache.delete(`${userId}-${service}`)
  })
}

/**
 * Get the appropriate key field from settings
 */
function getKeyFromSettings(settings: any, service: string): string | null {
  switch (service) {
    case 'claude':
      return settings.claudeApiKey || null
    case 'openai':
      return settings.openaiApiKey || null
    default:
      return null
  }
}

/**
 * Decrypt API key using the same method as the existing system
 */
function decryptApiKey(encryptedKey: string): string {
  const encryptionKey = process.env.ENCRYPTION_KEY

  if (!encryptionKey) {
    throw new Error('ENCRYPTION_KEY not found in environment variables')
  }

  try {
    const bytes = CryptoJS.AES.decrypt(encryptedKey, encryptionKey)
    const decrypted = bytes.toString(CryptoJS.enc.Utf8)

    if (!decrypted) {
      throw new Error('Failed to decrypt API key')
    }

    return decrypted
  } catch (error) {
    throw new Error(`API key decryption failed: ${error}`)
  }
}

/**
 * Decrypt API key using the new Node.js crypto format
 */
function decryptApiKeyNew(encryptedData: { encrypted: string; iv: string }): string {
  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  if (!ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY environment variable is required for decryption')
  }

  try {
    const algorithm = 'aes-256-cbc'
    const key = Buffer.from(ENCRYPTION_KEY, 'hex')
    const iv = Buffer.from(encryptedData.iv, 'hex')
    const decipher = crypto.createDecipheriv(algorithm, key, iv)
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  } catch (error) {
    throw new Error(`API key decryption failed: ${error}`)
  }
}

/**
 * Check if user has a valid API key for the service
 */
export async function hasValidApiKey(
  userId: string,
  service: 'claude' | 'openai' | 'gemini' | 'openclaw'
): Promise<boolean> {
  try {
    const key = await getCachedApiKey(userId, service)
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
  service: 'claude' | 'openai' | 'gemini' | 'openclaw'
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
      console.error('Failed to parse mcpSettings in getCachedModelPreference:', error)
      return null
    }

    // Get model preference
    const modelPreferences = settings.modelPreferences || {}
    return modelPreferences[service] || null
  } catch (error) {
    console.error(`Error getting ${service} model preference for user ${userId}:`, error)
    return null
  }
}

/**
 * Get the user's preferred AI service (with fallback)
 */
export async function getPreferredAIService(userId: string): Promise<'claude' | 'openai' | 'gemini' | 'openclaw'> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { aiAssistantSettings: true }
    })

    if (!user?.aiAssistantSettings) {
      return 'claude' // Default fallback
    }

    const settings = JSON.parse(user.aiAssistantSettings)

    // Check user's preferred service from settings
    if (settings.preferredService) {
      return settings.preferredService
    }

    // Fallback: return the first service that has an API key
    // Note: openclaw uses gateway URLs, not API keys, so it's not included here
    const services: Array<'claude' | 'openai' | 'gemini'> = ['claude', 'openai', 'gemini']

    for (const service of services) {
      if (await hasValidApiKey(userId, service)) {
        return service
      }
    }

    return 'claude' // Final fallback

  } catch (error) {
    console.error('Error getting preferred AI service:', error)
    return 'claude'
  }
}