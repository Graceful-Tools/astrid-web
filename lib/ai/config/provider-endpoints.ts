/**
 * Where each AI provider is reached (AWTD-1467).
 *
 * The hosts used to be hardcoded in every client. A partner on Azure needs
 * Azure OpenAI (a different base URL, an `api-key` header instead of a bearer
 * token, an `api-version` query) and possibly a Microsoft Foundry endpoint for
 * Claude. These variables are read here and nowhere else; unset, every URL and
 * header is exactly what it was before.
 *
 * Keys are unchanged: each user still brings their own, stored encrypted. An
 * Azure deployment's users store their Azure key as their OpenAI key.
 *
 *   OPENAI_BASE_URL     default https://api.openai.com/v1 — the URL that
 *                       `/chat/completions` is appended to, e.g.
 *                       https://<res>.openai.azure.com/openai/v1 or
 *                       https://<res>.openai.azure.com/openai/deployments/<name>
 *   OPENAI_API_VERSION  appended as ?api-version=… when set (Azure)
 *   ANTHROPIC_BASE_URL  default https://api.anthropic.com — `/v1/messages` is
 *                       appended, e.g. https://<res>.services.ai.azure.com/anthropic
 *   GEMINI_BASE_URL     default https://generativelanguage.googleapis.com
 */

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'
export const DEFAULT_ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
export const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com'

export interface ProviderEndpoints {
  openai: { baseUrl: string; apiVersion?: string; azure: boolean }
  anthropic: { baseUrl: string }
  gemini: { baseUrl: string }
}

type Env = Record<string, string | undefined>

const trimmed = (value: string | undefined, fallback: string): string => {
  const v = value?.trim()
  return (v ? v : fallback).replace(/\/+$/, '')
}

/** Azure OpenAI authenticates with `api-key`, not `Authorization: Bearer`. */
export function isAzureOpenAIUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host.endsWith('.openai.azure.com') || host.endsWith('.cognitiveservices.azure.com')
  } catch {
    return false
  }
}

export function resolveProviderEndpoints(env: Env): ProviderEndpoints {
  const openaiBase = trimmed(env.OPENAI_BASE_URL, DEFAULT_OPENAI_BASE_URL)
  const apiVersion = env.OPENAI_API_VERSION?.trim() || undefined
  return {
    openai: { baseUrl: openaiBase, apiVersion, azure: isAzureOpenAIUrl(openaiBase) },
    anthropic: { baseUrl: trimmed(env.ANTHROPIC_BASE_URL, DEFAULT_ANTHROPIC_BASE_URL) },
    gemini: { baseUrl: trimmed(env.GEMINI_BASE_URL, DEFAULT_GEMINI_BASE_URL) },
  }
}

let cached: ProviderEndpoints | null = null

/** The process's endpoints, read from the environment once. */
export function getProviderEndpoints(): ProviderEndpoints {
  if (!cached) {
    cached = resolveProviderEndpoints({
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
      OPENAI_API_VERSION: process.env.OPENAI_API_VERSION,
      ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
      GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
    })
  }
  return cached
}

/** Tests change the environment between cases. */
export function resetProviderEndpointsForTests(): void {
  cached = null
}

/** POST target for an OpenAI-compatible chat completion. */
export function openAIChatCompletionsUrl(endpoints = getProviderEndpoints()): string {
  const { baseUrl, apiVersion } = endpoints.openai
  const url = `${baseUrl}/chat/completions`
  return apiVersion ? `${url}?api-version=${encodeURIComponent(apiVersion)}` : url
}

/** The auth header for OpenAI: a bearer token, or `api-key` on Azure. */
export function openAIAuthHeaders(apiKey: string, endpoints = getProviderEndpoints()): Record<string, string> {
  return endpoints.openai.azure ? { 'api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }
}

/** POST target for Anthropic Messages. */
export function anthropicMessagesUrl(endpoints = getProviderEndpoints()): string {
  return `${endpoints.anthropic.baseUrl}/v1/messages`
}

/** POST target for Gemini generateContent. */
export function geminiGenerateContentUrl(model: string, apiKey: string, endpoints = getProviderEndpoints()): string {
  return `${endpoints.gemini.baseUrl}/v1beta/models/${model}:generateContent?key=${apiKey}`
}
