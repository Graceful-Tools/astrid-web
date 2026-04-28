/**
 * OpenAI API Client
 * Handles communication with OpenAI's API for code generation
 */

import { fetchWithTimeout, AI_REQUEST_TIMEOUT_MS } from './fetch-with-timeout'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai.clients.openai')


export interface OpenAIClientOptions {
  apiKey: string
  prompt: string
  jsonOnly?: boolean
  maxTokens?: number
  model?: string
  /** Maximum 429/5xx retry attempts (default: 3). Set to 0 to disable retries. */
  maxRetries?: number
  /** Override the sleep function (for tests). */
  sleepFn?: (ms: number) => Promise<void>
}

export interface OpenAIResponse {
  content: string
  model: string
  usage?: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}

const DEFAULT_MAX_RETRIES = 3
const BASE_RETRY_DELAY_MS = 1_000
const MAX_RETRY_DELAY_MS = 30_000

const defaultSleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/**
 * Compute backoff delay for the given attempt (1-indexed).
 * Honors the server-supplied Retry-After header when present (seconds or HTTP-date).
 * Otherwise falls back to capped exponential backoff with full jitter.
 */
export function computeRetryDelayMs(
  attempt: number,
  retryAfterHeader: string | null
): number {
  if (retryAfterHeader) {
    // Retry-After can be either seconds or an HTTP date.
    const seconds = Number(retryAfterHeader)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, MAX_RETRY_DELAY_MS)
    }
    const dateMs = Date.parse(retryAfterHeader)
    if (Number.isFinite(dateMs)) {
      const delta = dateMs - Date.now()
      if (delta > 0) return Math.min(delta, MAX_RETRY_DELAY_MS)
    }
  }
  const exponential = Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS)
  return Math.floor(Math.random() * exponential)
}

/**
 * Call OpenAI API for text/code generation.
 *
 * Retries on transient failures (HTTP 429 and 5xx) with exponential backoff +
 * full jitter, honoring the Retry-After header when present. Caps at 3 retries
 * by default. Other errors (4xx, network) fail fast.
 */
export async function callOpenAI(options: OpenAIClientOptions): Promise<OpenAIResponse> {
  const {
    apiKey,
    prompt,
    jsonOnly = false,
    maxTokens = 8192,
    model = 'gpt-4o',
    maxRetries = DEFAULT_MAX_RETRIES,
    sleepFn = defaultSleep,
  } = options

  const requestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: jsonOnly
        ? [
            {
              role: 'system',
              content: 'You are a code generation system. You MUST respond with ONLY valid JSON. Do not include any explanatory text, markdown formatting, or code blocks. Output pure JSON only.'
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        : [
            {
              role: 'user',
              content: prompt
            }
          ],
      max_tokens: maxTokens,
      ...(jsonOnly ? { response_format: { type: 'json_object' } } : {})
    })
  }

  let lastErrorText: string = ''
  let lastStatus: number = 0
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetchWithTimeout(
      'https://api.openai.com/v1/chat/completions',
      requestInit,
      AI_REQUEST_TIMEOUT_MS,
      'OpenAI'
    )

    if (response.ok) {
      const data = await response.json()
      const content = data.choices[0]?.message?.content
      if (!content) {
        throw new Error('OpenAI API returned empty response')
      }
      return {
        content,
        model: data.model,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens
        } : undefined
      }
    }

    lastStatus = response.status
    lastErrorText = await response.text().catch(() => response.statusText)

    const isRetryable = response.status === 429 || response.status >= 500
    if (!isRetryable || attempt >= maxRetries) {
      throw new Error(
        `OpenAI API error: ${response.status} ${response.statusText} - ${lastErrorText}`
      )
    }

    const delay = computeRetryDelayMs(attempt + 1, response.headers.get('retry-after'))
    log.warn(
      `[OpenAI] ${response.status} on attempt ${attempt + 1}/${maxRetries + 1} — backing off ${delay}ms`
    )
    await sleepFn(delay)
  }

  // Defensive — loop should always either return or throw above.
  throw new Error(
    `OpenAI API error: ${lastStatus} after ${maxRetries + 1} attempts - ${lastErrorText}`
  )
}
