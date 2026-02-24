/**
 * AI Provider Types
 *
 * Unified type definitions for all AI provider implementations.
 * Enables the orchestrator to call any provider with a consistent interface.
 */

import type { AILogger } from '../types/logger'

/**
 * Common options for all AI provider calls
 */
export interface AIProviderCallOptions {
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
}

/**
 * Standard response from AI providers
 */
export interface AIProviderResponse {
  /** The text content of the response */
  content: string
  /** Token usage information (if available) */
  usage?: {
    inputTokens: number
    outputTokens: number
  }
}

/**
 * Tool execution callback type
 */
export type ToolExecutionCallback = (toolName: string, input: any) => Promise<any>

/**
 * AI Service type (matches existing AIService type)
 */
export type AIServiceType = 'claude' | 'openai' | 'gemini' | 'openclaw'

/**
 * Provider interface for unified access
 */
export interface AIProvider {
  /** Provider name */
  name: AIServiceType
  /** Call the provider's API */
  call: (options: AIProviderCallOptions & Record<string, any>) => Promise<AIProviderResponse>
}

/**
 * Extended options for providers with tool support
 */
export interface AIProviderWithToolsOptions extends AIProviderCallOptions {
  /** Whether the provider has repository access for tool use */
  hasRepository?: boolean
  /** Callback to execute tools */
  executeToolCallback?: ToolExecutionCallback
}
