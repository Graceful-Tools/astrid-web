/**
 * OpenAI API Client
 * Handles communication with OpenAI's API for code generation
 */

import { fetchWithTimeout, AI_REQUEST_TIMEOUT_MS } from './fetch-with-timeout'

export interface OpenAIClientOptions {
  apiKey: string
  prompt: string
  jsonOnly?: boolean
  maxTokens?: number
  model?: string
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

/**
 * Call OpenAI API for text/code generation
 */
export async function callOpenAI(options: OpenAIClientOptions): Promise<OpenAIResponse> {
  const {
    apiKey,
    prompt,
    jsonOnly = false,
    maxTokens = 8192,
    model = 'gpt-4o'
  } = options

  const response = await fetchWithTimeout(
    'https://api.openai.com/v1/chat/completions',
    {
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
    },
    AI_REQUEST_TIMEOUT_MS,
    'OpenAI'
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText)
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`)
  }

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
