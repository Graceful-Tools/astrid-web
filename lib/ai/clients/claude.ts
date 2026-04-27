/**
 * Claude API Client
 * Handles communication with Anthropic's Claude API with tool use support
 *
 * Extracted from ai-orchestrator.ts for maintainability.
 */

import type { workflowQueue as WorkflowQueueType } from '../../workflow-queue'
import { fetchWithTimeout, AI_REQUEST_TIMEOUT_MS } from './fetch-with-timeout'

export interface ClaudeToolDefinition {
  name: string
  description: string
  input_schema: {
    type: string
    properties: Record<string, any>
    required?: string[]
  }
}

export interface ClaudeSystemBlock {
  type: string
  text: string
  cache_control?: { type: string }
}

export interface ClaudeClientOptions {
  apiKey: string
  prompt: string
  maxTokens?: number
  jsonOnly?: boolean
  systemBlocksOverride?: ClaudeSystemBlock[]
  tools?: ClaudeToolDefinition[]
  userId: string // For rate limiting tracking
  executeToolCallback?: (toolName: string, input: any) => Promise<any>
  logger?: (level: 'info' | 'warn' | 'error', message: string, meta?: any) => void
  /** Model to use (default: claude-sonnet-4-6) */
  model?: string
}

export interface ClaudeResponse {
  content: string
  usage?: {
    inputTokens: number
    outputTokens: number
    cacheCreationInputTokens?: number
    cacheReadInputTokens?: number
  }
}

/**
 * Default logger that outputs to console
 */
function defaultLogger(level: 'info' | 'warn' | 'error', message: string, meta: any = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'ClaudeClient',
    message,
    ...meta
  }
  console.log(JSON.stringify(logEntry))
}

/**
 * Build default system blocks based on mode
 */
function buildDefaultSystemBlocks(jsonOnly: boolean): ClaudeSystemBlock[] {
  return jsonOnly
    ? [
        {
          type: 'text',
          text: 'You are a code generation system. You MUST respond with ONLY valid JSON. Do not include any explanatory text, markdown formatting, or code blocks. Output pure JSON only.',
          cache_control: { type: 'ephemeral' }
        }
      ]
    : [
        {
          type: 'text',
          text: 'You are an expert software developer analyzing tasks for implementation in Next.js/React/TypeScript applications. Use the provided tools to explore the codebase and create focused implementation plans.',
          cache_control: { type: 'ephemeral' }
        }
      ]
}

/**
 * Call Claude API with tool use support
 *
 * Features:
 * - Tool use loop (up to 12 iterations for exploration, 1 for JSON-only)
 * - Rate limiting via WorkflowQueue integration
 * - Context pruning to stay within token limits
 * - Prompt caching support
 */
export async function callClaude(options: ClaudeClientOptions): Promise<ClaudeResponse> {
  const {
    apiKey,
    prompt,
    maxTokens = 8192,
    jsonOnly = false,
    systemBlocksOverride,
    tools = [],
    userId,
    executeToolCallback,
    logger = defaultLogger,
    model = 'claude-sonnet-4-6'
  } = options

  // Import WorkflowQueue for global token tracking
  const { workflowQueue } = await import('../../workflow-queue')

  // Use provided system blocks or fall back to defaults
  const systemBlocks = systemBlocksOverride || buildDefaultSystemBlocks(jsonOnly)

  let messages: Array<{ role: string; content: string | any[] }> = [
    {
      role: 'user',
      content: prompt
    }
  ]

  // Tool use loop configuration
  // - JSON-only mode: single request, no tools
  // - Planning mode: up to 12 iterations for thorough exploration
  const maxIterations = jsonOnly ? 1 : 12
  let iteration = 0
  const tokenBudget = 30000 // Rate limit: 30k tokens per minute per API key

  while (iteration < maxIterations) {
    iteration++

    // Rate limit protection with global rolling window
    await handleRateLimiting(workflowQueue, userId, tokenBudget, iteration, logger)

    // Prune context if too large (keep tool_use/tool_result pairs together)
    messages = pruneContextIfNeeded(messages, logger)

    // Make API request
    let response
    try {
      response = await fetchWithTimeout(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'prompt-caching-2024-07-31'
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            system: systemBlocks,
            messages,
            tools: jsonOnly ? undefined : (tools.length > 0 ? tools : undefined)
          })
        },
        AI_REQUEST_TIMEOUT_MS,
        'Claude'
      )
    } catch (fetchError) {
      logger('error', 'Claude API fetch failed', {
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        stack: fetchError instanceof Error ? fetchError.stack : undefined,
        iteration,
        messagesCount: messages.length
      })
      throw new Error(
        `Failed to connect to Claude API: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}. Check network connectivity and API key.`
      )
    }

    if (!response.ok) {
      let errorDetails = response.statusText
      try {
        const errorBody = await response.text()
        errorDetails = `${response.statusText} - ${errorBody}`
      } catch {
        // If we can't read the response body, just use statusText
      }
      logger('error', 'Claude API returned error', {
        status: response.status,
        statusText: response.statusText,
        errorDetails
      })
      throw new Error(`Claude API error: ${errorDetails}`)
    }

    const data = await response.json()

    // Record token usage in global tracker
    const usage = data.usage
    if (usage) {
      const totalInput = usage.input_tokens + (usage.cache_creation_input_tokens || 0)
      workflowQueue.recordTokens(userId, totalInput)

      const tokensInGlobalWindow = workflowQueue.getTokensUsedInWindow(userId)

      logger('info', 'Token usage recorded (global)', {
        iteration,
        maxIterations,
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheCreation: usage.cache_creation_input_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
        totalInput,
        tokensInGlobalWindow,
        messages: messages.length
      })

      if (tokensInGlobalWindow > 25000) {
        logger('warn', 'Approaching rate limit threshold (global)', {
          tokensInWindow: tokensInGlobalWindow,
          limit: tokenBudget
        })
      }
    }

    // Check if Claude wants to use a tool
    const toolUseBlock = data.content.find((block: any) => block.type === 'tool_use')

    if (!toolUseBlock) {
      // No tool use, return the text response
      const textBlock = data.content.find((block: any) => block.type === 'text')
      return {
        content: textBlock?.text || '',
        usage: usage ? {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheCreationInputTokens: usage.cache_creation_input_tokens,
          cacheReadInputTokens: usage.cache_read_input_tokens
        } : undefined
      }
    }

    // Execute the tool call
    if (!executeToolCallback) {
      logger('warn', 'Tool use requested but no callback provided', { toolName: toolUseBlock.name })
      throw new Error(`Tool use requested (${toolUseBlock.name}) but no executeToolCallback provided`)
    }

    console.log(`🔧 [Claude] Tool use requested: ${toolUseBlock.name}`, toolUseBlock.input)
    const toolResult = await executeToolCallback(toolUseBlock.name, toolUseBlock.input)
    console.log(`✅ [Claude] Tool result:`, toolResult)

    // Add assistant message with tool use
    messages.push({
      role: 'assistant',
      content: data.content
    })

    // Add tool result with cache control on every 3rd iteration
    const toolResultContent: any[] = [
      {
        type: 'tool_result',
        tool_use_id: toolUseBlock.id,
        content: JSON.stringify(toolResult)
      }
    ]

    // Mark for caching every 3rd tool result to build up cached context
    if (iteration % 3 === 0) {
      toolResultContent[0].cache_control = { type: 'ephemeral' }
      console.log(`💾 [Cache] Marking iteration ${iteration} for caching`)
    }

    messages.push({
      role: 'user',
      content: toolResultContent
    })

    // Continue the loop to get Claude's next response
  }

  // Reached max iterations - request final response
  logger('warn', 'Max iterations reached, requesting final response', {
    iterations: maxIterations,
    messagesExchanged: messages.length
  })

  return await requestFinalResponse(apiKey, systemBlocks, messages, maxTokens, logger, model)
}

/**
 * Handle rate limiting by checking global token window and waiting if needed
 */
async function handleRateLimiting(
  workflowQueue: typeof WorkflowQueueType,
  userId: string,
  tokenBudget: number,
  iteration: number,
  logger: (level: 'info' | 'warn' | 'error', message: string, meta?: any) => void
): Promise<void> {
  const tokensInWindow = workflowQueue.getTokensUsedInWindow(userId)

  // If approaching limit (25k threshold with 5k buffer), wait for window to clear
  if (tokensInWindow > 25000) {
    const msToWait = 61000 // 61 seconds to be safe
    const waitSeconds = Math.round(msToWait / 1000)

    logger('warn', 'Approaching rate limit (global), waiting for rolling window to clear', {
      tokensInWindow,
      tokenLimit: tokenBudget,
      waitSeconds,
      iteration,
      userId
    })

    await new Promise(resolve => setTimeout(resolve, msToWait))

    logger('info', 'Rate limit window cleared (global)', {
      previousTokens: tokensInWindow,
      currentTokens: workflowQueue.getTokensUsedInWindow(userId)
    })
  }
}

/**
 * Prune context to stay under rate limits while keeping tool_use/tool_result pairs together
 */
function pruneContextIfNeeded(
  messages: Array<{ role: string; content: string | any[] }>,
  logger: (level: 'info' | 'warn' | 'error', message: string, meta?: any) => void
): Array<{ role: string; content: string | any[] }> {
  if (messages.length <= 10) {
    return messages
  }

  // Keep initial task and last 6 messages (3 complete exchanges)
  const firstMessage = messages[0]
  let recentMessages = messages.slice(-6)

  // Verify we're not breaking tool use pairs
  // If the first recent message is a tool_result, include the previous message too
  const firstRecentMsg = recentMessages[0]
  if (
    firstRecentMsg.role === 'user' &&
    Array.isArray(firstRecentMsg.content) &&
    firstRecentMsg.content.some((c: any) => c.type === 'tool_result')
  ) {
    // Include one more message to get the tool_use
    const extraMessage = messages[messages.length - 7]
    if (extraMessage) {
      recentMessages = [extraMessage, ...recentMessages]
    }
  }

  const prunedMessages = [firstMessage, ...recentMessages]

  console.log(`🔧 [Context] Pruned to ${prunedMessages.length} messages to stay under rate limits`)

  return prunedMessages
}

/**
 * Request final response after max iterations reached
 */
async function requestFinalResponse(
  apiKey: string,
  systemBlocks: ClaudeSystemBlock[],
  messages: Array<{ role: string; content: string | any[] }>,
  maxTokens: number,
  logger: (level: 'info' | 'warn' | 'error', message: string, meta?: any) => void,
  model: string = 'claude-sonnet-4-6'
): Promise<ClaudeResponse> {
  // Add a final message asking Claude to provide its best answer
  messages.push({
    role: 'user',
    content:
      'You have reached the iteration limit. Please provide your implementation plan now based on what you have explored so far. ' +
      'Follow the format specified in the original instructions (SUMMARY, APPROACH, FILES TO MODIFY, etc.).'
  })

  const finalResponse = await fetchWithTimeout(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31'
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemBlocks,
        messages
      })
    },
    AI_REQUEST_TIMEOUT_MS,
    'Claude'
  )

  if (!finalResponse.ok) {
    logger('error', 'Final response request failed', {
      status: finalResponse.status,
      statusText: finalResponse.statusText
    })

    // If rate limited on final response, return a helpful message instead of failing
    if (finalResponse.status === 429) {
      logger('warn', 'Rate limited on final response, returning partial analysis')
      return {
        content:
          'I explored the codebase thoroughly but hit API rate limits. Based on my analysis:\n\n' +
          'Please try reassigning the task in a few minutes, or simplify the task description to require less exploration.'
      }
    }

    throw new Error(`Failed to get final response after max iterations`)
  }

  const finalData = await finalResponse.json()
  const finalTextBlock = finalData.content.find((block: any) => block.type === 'text')

  logger('info', 'Final response received after max iterations', {
    hasResponse: !!finalTextBlock?.text
  })

  return {
    content:
      finalTextBlock?.text ||
      'Unable to generate plan within iteration limit. Please try a simpler task description.',
    usage: finalData.usage ? {
      inputTokens: finalData.usage.input_tokens,
      outputTokens: finalData.usage.output_tokens,
      cacheCreationInputTokens: finalData.usage.cache_creation_input_tokens,
      cacheReadInputTokens: finalData.usage.cache_read_input_tokens
    } : undefined
  }
}
