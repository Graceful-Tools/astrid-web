/**
 * Gemini API Client
 * Handles communication with Google's Gemini API for code generation
 */

import { fetchWithTimeout, AI_REQUEST_TIMEOUT_MS } from './fetch-with-timeout'

export interface GeminiClientOptions {
  apiKey: string
  prompt: string
  jsonOnly?: boolean
  maxTokens?: number
  model?: string
  temperature?: number
}

export interface GeminiResponse {
  content: string
  model: string
}

interface LogFunction {
  (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>): void
}

/**
 * Parse Gemini API error response into a user-friendly message
 */
function parseGeminiError(status: number, errorText: string): string {
  try {
    const errorData = JSON.parse(errorText)
    const message = errorData?.error?.message || ''
    const code = errorData?.error?.code || status

    // Handle common error cases with clear messages
    if (code === 429 || message.includes('quota') || message.includes('rate')) {
      if (message.includes('free_tier')) {
        return 'Gemini API free tier limit reached. Please upgrade to a paid plan or wait a moment.'
      }
      return 'Gemini API rate limit exceeded. Please wait a moment and try again.'
    }

    if (code === 404 || message.includes('not found')) {
      return 'Gemini model not available. The API may be experiencing issues.'
    }

    if (code === 401 || code === 403) {
      return 'Gemini API key is invalid or unauthorized. Please check your API key.'
    }

    // Extract just the main message without the JSON blob
    if (message) {
      // Truncate long messages and remove JSON-like content
      const cleanMessage = message.split('\n')[0].substring(0, 200)
      return `Gemini API error: ${cleanMessage}`
    }

    return `Gemini API error (${code})`
  } catch {
    // If JSON parsing fails, return a simple message
    return `Gemini API error (${status})`
  }
}

/**
 * Call Gemini API for text/code generation
 */
export async function callGemini(
  options: GeminiClientOptions,
  log?: LogFunction
): Promise<GeminiResponse> {
  const {
    apiKey,
    prompt,
    jsonOnly = false,
    maxTokens = 8192,
    model = 'gemini-2.5-flash',
    temperature = 0.7
  } = options

  const systemInstruction = jsonOnly
    ? 'You are a code generation system. You MUST respond with ONLY valid JSON. Do not include any explanatory text, markdown formatting, or code blocks. Output pure JSON only.'
    : 'You are an expert software developer analyzing tasks for implementation in Next.js/React/TypeScript applications.'

  const response = await fetchWithTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemInstruction }]
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
          ...(jsonOnly ? { responseMimeType: 'application/json' } : {})
        }
      })
    },
    AI_REQUEST_TIMEOUT_MS,
    'Gemini'
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText)
    log?.('error', 'Gemini API error', { status: response.status, error: errorText })
    throw new Error(parseGeminiError(response.status, errorText))
  }

  const data = await response.json()

  // Gemini returns content in a different structure
  const candidate = data.candidates?.[0]
  const content = candidate?.content?.parts?.[0]?.text

  if (!content) {
    // Check for specific reasons why content is empty
    const finishReason = candidate?.finishReason
    const blockReason = data.promptFeedback?.blockReason
    const safetyRatings = candidate?.safetyRatings || data.promptFeedback?.safetyRatings

    log?.('error', 'Gemini API returned empty response', {
      data,
      finishReason,
      blockReason,
      safetyRatings
    })

    if (blockReason) {
      throw new Error(`Gemini blocked the prompt: ${blockReason}`)
    }
    if (finishReason === 'SAFETY') {
      throw new Error('Gemini blocked the response due to safety filters')
    }
    if (finishReason === 'RECITATION') {
      throw new Error('Gemini blocked the response due to recitation policy')
    }
    if (finishReason && finishReason !== 'STOP') {
      throw new Error(`Gemini stopped unexpectedly: ${finishReason}`)
    }

    throw new Error('Gemini API returned empty response')
  }

  return {
    content,
    model
  }
}
