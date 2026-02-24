/**
 * OpenAI AI Provider
 *
 * High-level provider wrapper for OpenAI API calls in the AIOrchestrator context.
 * Handles function calling for repository exploration during planning/implementation.
 *
 * This module handles:
 * - Tool definitions for OpenAI function calling
 * - Integration with the unified provider interface
 * - Multi-turn conversation with tool execution loop
 */

import type { AILogger } from '../types/logger'
import type { AIProviderCallOptions, AIProviderResponse, ToolExecutionCallback } from './types'

/**
 * OpenAI-compatible tool definitions for function calling
 */
export const OPENAI_REPOSITORY_TOOLS = [
  {
    type: 'function' as const,
    function: {
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
  },
  {
    type: 'function' as const,
    function: {
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
  },
]

/**
 * OpenAI message type for conversation history
 */
type OpenAIMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

/**
 * OpenAI-specific call options
 */
export interface OpenAIProviderOptions extends AIProviderCallOptions {
  /** Tool execution callback for MCP operations */
  executeToolCallback?: ToolExecutionCallback
  /** Whether the repository is available for tool use */
  hasRepository?: boolean
  /** Model to use (optional, uses API default if not specified) */
  model?: string
}

/**
 * Default logger that outputs to console
 */
function defaultLogger(level: 'info' | 'warn' | 'error', message: string, meta: any = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'OpenAIProvider',
    message,
    ...meta,
  }
  console.log(JSON.stringify(logEntry))
}

/**
 * Call OpenAI API with function calling support
 *
 * Features:
 * - Multi-turn conversation with tool use loop (up to 30 iterations)
 * - Automatic JSON response format when jsonOnly is true
 * - Repository exploration via function calling
 */
export async function callOpenAI(options: OpenAIProviderOptions): Promise<AIProviderResponse> {
  const {
    apiKey,
    prompt,
    maxTokens = 8192,
    jsonOnly = false,
    executeToolCallback,
    hasRepository = false,
    logger = defaultLogger,
    model,
  } = options

  const useTools = hasRepository && !jsonOnly && !!executeToolCallback
  const maxIterations = 30

  const messages: OpenAIMessage[] = [
    {
      role: 'system',
      content: jsonOnly
        ? 'You are a code generation system. You MUST respond with ONLY valid JSON. Do not include any explanatory text, markdown formatting, or code blocks. Output pure JSON only.'
        : 'You are an expert software developer analyzing tasks for implementation. Use the available tools to explore the codebase before creating your plan.',
    },
    { role: 'user', content: prompt },
  ]

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const requestBody: Record<string, unknown> = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    }

    if (useTools) {
      requestBody.tools = OPENAI_REPOSITORY_TOOLS
      requestBody.tool_choice = 'auto'
    }

    if (jsonOnly) {
      requestBody.response_format = { type: 'json_object' }
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText)
      logger('error', 'OpenAI API error', { status: response.status, error: errorText })
      throw new Error(`OpenAI API error (${response.status}): ${errorText.substring(0, 200)}`)
    }

    const data = await response.json()
    const choice = data.choices?.[0]

    if (!choice) {
      throw new Error('No response from OpenAI')
    }

    const message = choice.message

    // Check for tool calls
    if (message.tool_calls && message.tool_calls.length > 0 && executeToolCallback) {
      // Add assistant message with tool calls
      messages.push({
        role: 'assistant',
        content: message.content,
        tool_calls: message.tool_calls,
      })

      // Execute each tool call
      for (const toolCall of message.tool_calls) {
        const { name, arguments: argsJson } = toolCall.function
        logger('info', 'OpenAI tool call', { tool: name, args: argsJson })

        let result: string
        try {
          const args = JSON.parse(argsJson)
          const toolResult = await executeToolCallback(name, args)
          result = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
        } catch (error) {
          result = `Error: ${error instanceof Error ? error.message : String(error)}`
        }

        // Add tool response
        messages.push({
          role: 'tool',
          content: result,
          tool_call_id: toolCall.id,
        })
      }

      continue
    }

    // No tool calls - return content
    if (message.content) {
      return {
        content: message.content,
        usage: data.usage
          ? {
              inputTokens: data.usage.prompt_tokens,
              outputTokens: data.usage.completion_tokens,
            }
          : undefined,
      }
    }

    throw new Error('OpenAI returned empty response')
  }

  throw new Error('OpenAI max iterations reached')
}

/**
 * Default export for provider interface compatibility
 */
const openaiProvider = {
  name: 'openai' as const,
  call: callOpenAI,
  repositoryTools: OPENAI_REPOSITORY_TOOLS,
}

export default openaiProvider
