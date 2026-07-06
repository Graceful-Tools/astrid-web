/**
 * AI Providers
 *
 * Unified interface for all AI provider implementations.
 * Allows the AIOrchestrator to call any provider with a consistent interface.
 */

// Export types
export type {
  AIProviderCallOptions,
  AIProviderResponse,
  AIProviderWithToolsOptions,
  AIServiceType,
  AIProvider,
  ToolExecutionCallback,
} from './types'

// Export individual providers
export {
  callClaude,
  CLAUDE_REPOSITORY_TOOLS,
  type ClaudeProviderOptions,
} from './claude-provider'

export {
  callOpenAI,
  OPENAI_REPOSITORY_TOOLS,
  type OpenAIProviderOptions,
} from './openai-provider'

export {
  callGemini,
  GEMINI_REPOSITORY_TOOLS,
  type GeminiProviderOptions,
} from './gemini-provider'

export {
  callCopilot,
  COPILOT_REPOSITORY_TOOLS,
  type CopilotProviderOptions,
} from './copilot-provider'

// Import providers for the unified interface
import { callClaude, type ClaudeProviderOptions } from './claude-provider'
import { callOpenAI, type OpenAIProviderOptions } from './openai-provider'
import { callGemini, type GeminiProviderOptions } from './gemini-provider'
import { callCopilot, type CopilotProviderOptions } from './copilot-provider'
import type { AIServiceType, AIProviderResponse, ToolExecutionCallback } from './types'
import type { ClaudeSystemBlock } from '../clients/claude'
import type { AILogger } from '../types/logger'

/**
 * Unified provider options that work with any AI service
 */
export interface UnifiedProviderOptions {
  /** The AI service to use */
  service: AIServiceType
  /** API key for the provider */
  apiKey: string
  /** The prompt to send to the AI */
  prompt: string
  /** Maximum tokens for the response */
  maxTokens?: number
  /** Whether to require JSON-only output */
  jsonOnly?: boolean
  /** User ID for rate limiting tracking */
  userId: string
  /** Logger function for debugging */
  logger?: AILogger
  /** Whether the repository is available for tool use */
  hasRepository?: boolean
  /** Callback to execute tools */
  executeToolCallback?: ToolExecutionCallback
  /** System blocks override (Claude only) */
  systemBlocksOverride?: ClaudeSystemBlock[]
  /** Model override (provider-specific) */
  model?: string
}

/**
 * Call any AI provider with a unified interface
 *
 * This function routes the call to the appropriate provider based on the service type,
 * translating the unified options to provider-specific options.
 *
 * @example
 * ```ts
 * const response = await callProvider({
 *   service: 'claude',
 *   apiKey: 'sk-...',
 *   prompt: 'Generate code for...',
 *   userId: 'user-123',
 *   hasRepository: true,
 *   executeToolCallback: async (name, input) => executeTool(name, input)
 * })
 * ```
 */
export async function callProvider(options: UnifiedProviderOptions): Promise<AIProviderResponse> {
  const {
    service,
    apiKey,
    prompt,
    maxTokens = 8192,
    jsonOnly = false,
    userId,
    logger,
    hasRepository = false,
    executeToolCallback,
    systemBlocksOverride,
    model,
  } = options

  switch (service) {
    case 'claude': {
      const claudeOptions: ClaudeProviderOptions = {
        apiKey,
        prompt,
        maxTokens,
        jsonOnly,
        userId,
        logger,
        hasRepository,
        executeToolCallback,
        systemBlocksOverride,
      }
      return callClaude(claudeOptions)
    }

    case 'openai': {
      const openaiOptions: OpenAIProviderOptions = {
        apiKey,
        prompt,
        maxTokens,
        jsonOnly,
        userId,
        logger,
        hasRepository,
        executeToolCallback,
        model,
      }
      return callOpenAI(openaiOptions)
    }

    case 'gemini': {
      const geminiOptions: GeminiProviderOptions = {
        apiKey,
        prompt,
        maxTokens,
        jsonOnly,
        userId,
        logger,
        hasRepository,
        executeToolCallback,
        model,
      }
      return callGemini(geminiOptions)
    }

    case 'copilot': {
      const copilotOptions: CopilotProviderOptions = {
        apiKey,
        prompt,
        maxTokens,
        jsonOnly,
        userId,
        logger,
        hasRepository,
        executeToolCallback,
        model,
      }
      return callCopilot(copilotOptions)
    }

    default:
      throw new Error(`Unsupported AI service: ${service}`)
  }
}

/**
 * Get repository tools for a specific provider
 * Useful when you need to inspect what tools are available
 */
export function getRepositoryTools(service: AIServiceType): any[] {
  switch (service) {
    case 'claude':
      return require('./claude-provider').CLAUDE_REPOSITORY_TOOLS
    case 'openai':
      return require('./openai-provider').OPENAI_REPOSITORY_TOOLS
    case 'gemini':
      return require('./gemini-provider').GEMINI_REPOSITORY_TOOLS
    default:
      return []
  }
}
