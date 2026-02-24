/**
 * Claude AI Provider
 *
 * High-level provider wrapper for Claude API calls in the AIOrchestrator context.
 * Wraps the low-level client from lib/ai/clients/claude.ts with orchestrator-specific logic.
 *
 * This module handles:
 * - Tool definitions for MCP repository operations
 * - Integration with the unified provider interface
 * - Orchestrator-specific system blocks and configuration
 */

import {
  callClaude as callClaudeClient,
  type ClaudeSystemBlock,
  type ClaudeToolDefinition,
} from '../clients/claude'
import type { AILogger } from '../types/logger'
import type { AIProviderCallOptions, AIProviderResponse } from './types'

/**
 * MCP tool definitions for Claude API
 * Used to allow Claude to explore the GitHub repository during planning/implementation
 */
export const CLAUDE_REPOSITORY_TOOLS: ClaudeToolDefinition[] = [
  {
    name: 'get_repository_file',
    description:
      'Read the contents of a file from the GitHub repository. Use this to read README.md, source files, configuration files, etc.',
    input_schema: {
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
    input_schema: {
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
 * Claude-specific call options
 */
export interface ClaudeProviderOptions extends AIProviderCallOptions {
  /** System blocks override for progressive caching */
  systemBlocksOverride?: ClaudeSystemBlock[]
  /** Tool execution callback for MCP operations */
  executeToolCallback?: (toolName: string, input: any) => Promise<any>
  /** Whether the repository is available for tool use */
  hasRepository?: boolean
}

/**
 * Call Claude API through the provider interface
 *
 * Features:
 * - Automatic tool configuration based on repository availability
 * - Integration with progressive system blocks caching
 * - MCP tool execution for repository exploration
 */
export async function callClaude(options: ClaudeProviderOptions): Promise<AIProviderResponse> {
  const {
    apiKey,
    prompt,
    maxTokens = 8192,
    jsonOnly = false,
    systemBlocksOverride,
    executeToolCallback,
    hasRepository = false,
    userId,
    logger,
  } = options

  // Use MCP tools if repository is available and not in JSON-only mode
  const tools = hasRepository && !jsonOnly ? CLAUDE_REPOSITORY_TOOLS : []

  const response = await callClaudeClient({
    apiKey,
    prompt,
    maxTokens,
    jsonOnly,
    systemBlocksOverride,
    tools,
    userId,
    executeToolCallback,
    logger,
  })

  return {
    content: response.content,
    usage: response.usage
      ? {
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        }
      : undefined,
  }
}

/**
 * Default export for provider interface compatibility
 */
const claudeProvider = {
  name: 'claude' as const,
  call: callClaude,
  repositoryTools: CLAUDE_REPOSITORY_TOOLS,
}

export default claudeProvider
