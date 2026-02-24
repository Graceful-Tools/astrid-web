/**
 * Gemini AI Provider
 *
 * High-level provider wrapper for Google Gemini API calls in the AIOrchestrator context.
 * Handles function calling for repository exploration during planning/implementation.
 *
 * This module handles:
 * - Tool definitions for Gemini function calling
 * - Integration with the unified provider interface
 * - Multi-turn conversation with function execution loop
 */

import type { AILogger } from '../types/logger'
import type { AIProviderCallOptions, AIProviderResponse, ToolExecutionCallback } from './types'

/**
 * Gemini-compatible tool definitions for function calling
 */
export const GEMINI_REPOSITORY_TOOLS = [
  {
    name: 'get_repository_file',
    description:
      'Read the contents of a file from the GitHub repository. Use this to read README.md, source files, configuration files, etc.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The file path in the repository (e.g., "README.md", "src/index.ts")',
        },
        ref: {
          type: 'string',
          description: 'Optional branch or commit ref (defaults to default branch)',
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_repository_files',
    description: 'List all files and directories in a specific directory of the repository',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The directory path to list (empty string or "/" for root)',
        },
        ref: {
          type: 'string',
          description: 'Optional branch or commit ref (defaults to default branch)',
        },
      },
      required: [],
    },
  },
]

/**
 * Gemini content part types
 */
type GeminiPart = {
  text?: string
  functionCall?: { name: string; args: Record<string, unknown> }
  functionResponse?: { name: string; response: { result: string } }
}

/**
 * Gemini content message type
 */
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

/**
 * Gemini-specific call options
 */
export interface GeminiProviderOptions extends AIProviderCallOptions {
  /** Tool execution callback for MCP operations */
  executeToolCallback?: ToolExecutionCallback
  /** Whether the repository is available for tool use */
  hasRepository?: boolean
  /** Model to use (defaults to gemini-2.0-flash) */
  model?: string
}

/**
 * Default logger that outputs to console
 */
function defaultLogger(level: 'info' | 'warn' | 'error', message: string, meta: any = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'GeminiProvider',
    message,
    ...meta,
  }
  console.log(JSON.stringify(logEntry))
}

/**
 * Call Gemini API with function calling support
 *
 * Features:
 * - Multi-turn conversation with function use loop (up to 30 iterations)
 * - Automatic JSON response format when jsonOnly is true
 * - Repository exploration via function calling
 */
export async function callGemini(options: GeminiProviderOptions): Promise<AIProviderResponse> {
  const {
    apiKey,
    prompt,
    maxTokens = 8192,
    jsonOnly = false,
    executeToolCallback,
    hasRepository = false,
    logger = defaultLogger,
    model = 'gemini-2.0-flash',
  } = options

  const useTools = hasRepository && !jsonOnly && !!executeToolCallback
  const maxIterations = 30

  // Build initial contents
  const contents: GeminiContent[] = [{ role: 'user', parts: [{ text: prompt }] }]

  const systemInstruction = jsonOnly
    ? 'You are a code generation system. You MUST respond with ONLY valid JSON. Do not include any explanatory text, markdown formatting, or code blocks. Output pure JSON only.'
    : 'You are an expert software developer analyzing tasks for implementation. Use the available tools to explore the codebase before creating your plan.'

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

    const requestBody: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
        ...(jsonOnly ? { responseMimeType: 'application/json' } : {}),
      },
    }

    // Add tools if enabled
    if (useTools) {
      requestBody.tools = [{ functionDeclarations: GEMINI_REPOSITORY_TOOLS }]
      requestBody.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText)
      logger('error', 'Gemini API error', { status: response.status, error: errorText })
      throw new Error(`Gemini API error (${response.status}): ${errorText.substring(0, 200)}`)
    }

    const data = await response.json()
    const candidate = data.candidates?.[0]

    if (!candidate) {
      throw new Error('No response from Gemini')
    }

    // Add model response to history
    contents.push({ role: 'model', parts: candidate.content.parts })

    // Check for function calls
    const functionCalls = candidate.content.parts.filter((p: GeminiPart) => p.functionCall)

    if (functionCalls.length > 0 && executeToolCallback) {
      const functionResponses: GeminiPart[] = []

      for (const part of functionCalls) {
        if (!part.functionCall) continue

        const { name, args } = part.functionCall
        logger('info', 'Gemini tool call', { tool: name, args })

        try {
          const result = await executeToolCallback(name, args)
          functionResponses.push({
            functionResponse: {
              name,
              response: { result: typeof result === 'string' ? result : JSON.stringify(result) },
            },
          })
        } catch (error) {
          functionResponses.push({
            functionResponse: {
              name,
              response: { result: `Error: ${error instanceof Error ? error.message : String(error)}` },
            },
          })
        }
      }

      // Add function responses and continue
      contents.push({ role: 'user', parts: functionResponses })
      continue
    }

    // No function calls - return text response
    const textPart = candidate.content.parts.find((p: GeminiPart) => p.text)
    if (textPart?.text) {
      // Gemini doesn't provide standard usage metrics in the same format
      return {
        content: textPart.text,
        usage: data.usageMetadata
          ? {
              inputTokens: data.usageMetadata.promptTokenCount || 0,
              outputTokens: data.usageMetadata.candidatesTokenCount || 0,
            }
          : undefined,
      }
    }

    // Empty response
    throw new Error('Gemini returned empty response')
  }

  throw new Error('Gemini max iterations reached')
}

/**
 * Default export for provider interface compatibility
 */
const geminiProvider = {
  name: 'gemini' as const,
  call: callGemini,
  repositoryTools: GEMINI_REPOSITORY_TOOLS,
}

export default geminiProvider
