import { createLogger } from '@/lib/logger'

const log = createLogger('ai.fetch-provider-models')

/**
 * Fetch Available Models from AI Provider APIs
 *
 * Queries each provider's models endpoint using the user's API key.
 * Results are cached in-memory for 1 hour to avoid excessive API calls.
 */

// In-memory cache: key = `${service}:${keyPrefix}` → { models, fetchedAt }
const modelCache = new Map<string, { models: string[]; fetchedAt: number }>()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Fetch available models from a provider API using the user's decrypted API key.
 * Returns sorted model IDs relevant for chat/completion use.
 */
export async function fetchProviderModels(
  service: 'claude' | 'openai' | 'gemini' | 'copilot',
  apiKey: string
): Promise<string[]> {
  // Cache key uses first 8 chars of key to scope per-key without storing the full key
  const cacheKey = `${service}:${apiKey.substring(0, 8)}`
  const cached = modelCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.models
  }

  try {
    let models: string[]
    switch (service) {
      case 'claude':
        models = await fetchClaudeModels(apiKey)
        break
      case 'openai':
        models = await fetchOpenAIModels(apiKey)
        break
      case 'gemini':
        models = await fetchGeminiModels(apiKey)
        break
      case 'copilot':
        // Model enumeration through the SDK would start a CLI runtime during a
        // settings-page request. Use the reviewed static list instead.
        models = []
        break
      default:
        return []
    }

    modelCache.set(cacheKey, { models, fetchedAt: Date.now() })
    return models
  } catch (error) {
    log.error({ err: error }, `[fetchProviderModels] Error fetching ${service} models:`)
    return []
  }
}

async function fetchClaudeModels(apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  })
  if (!res.ok) return []
  const data = await res.json()
  // data.data is an array of { id, type, display_name, created_at }
  const models: string[] = (data.data || [])
    .map((m: { id: string }) => m.id)
    .filter((id: string) => !id.includes('claude-2') && !id.includes('claude-instant'))
    .sort((a: string, b: string) => b.localeCompare(a)) // Newest first (alphabetically desc)
  return models
}

async function fetchOpenAIModels(apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
  if (!res.ok) return []
  const data = await res.json()
  // Filter to GPT and O-series models relevant for chat
  const models: string[] = (data.data || [])
    .map((m: { id: string }) => m.id)
    .filter((id: string) =>
      id.startsWith('gpt-4') || id.startsWith('gpt-3.5') ||
      id.startsWith('o1') || id.startsWith('o3') || id.startsWith('o4') ||
      id.startsWith('chatgpt')
    )
    .sort((a: string, b: string) => b.localeCompare(a))
  return models
}

async function fetchGeminiModels(apiKey: string): Promise<string[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
  if (!res.ok) return []
  const data = await res.json()
  // Filter to generateContent-capable models
  const models: string[] = (data.models || [])
    .filter((m: { supportedGenerationMethods?: string[] }) =>
      m.supportedGenerationMethods?.includes('generateContent')
    )
    .map((m: { name: string }) => m.name.replace('models/', ''))
    .filter((id: string) => id.startsWith('gemini'))
    .sort((a: string, b: string) => b.localeCompare(a))
  return models
}
