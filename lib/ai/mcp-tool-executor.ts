/**
 * MCP Tool Executor Service
 *
 * Handles execution of MCP (Model Context Protocol) tool calls.
 * Used by Claude API to explore GitHub repositories during planning/implementation.
 */

import { generateFilePathVariations } from './file-path-utils'
import type { MCPToolLogger } from './types/logger'
import { createLogger } from '@/lib/logger'

const log = createLogger('ai.mcp-tool-executor')


// Re-export for backward compatibility
export type { MCPToolLogger }

/**
 * Callback to cache explored files
 */
export type ExploredFileCache = (path: string, content: string, timestamp: number) => void

/**
 * GitHub client interface for MCP operations
 */
export interface MCPGitHubClient {
  getFile(repository: string, path: string, ref?: string): Promise<string>
  listFiles(repository: string, path: string, ref?: string): Promise<Array<{ path: string; type: string }>>
}

/**
 * Dependencies for MCP tool execution
 */
export interface MCPToolDependencies {
  repositoryId: string
  githubClient: MCPGitHubClient
  logger?: MCPToolLogger
  cacheExploredFile?: ExploredFileCache
}

/**
 * Result of MCP tool execution
 */
export interface MCPToolResult {
  success: boolean
  path?: string
  originalPath?: string
  content?: string
  files?: Array<{ path: string; type: string }>
  error?: string
}

/**
 * Execute a get_repository_file tool call
 * Tries multiple path variations to handle case sensitivity and naming conventions
 */
export async function executeGetFile(
  input: { path: string; ref?: string },
  deps: MCPToolDependencies
): Promise<MCPToolResult> {
  const { repositoryId, githubClient, logger, cacheExploredFile } = deps

  // Try multiple path variations if the original fails
  const pathVariations = generateFilePathVariations(input.path)
  let fileContent: string | null = null
  let successfulPath: string | null = null
  let lastError: Error | null = null

  for (const pathVariation of pathVariations) {
    try {
      fileContent = await githubClient.getFile(
        repositoryId,
        pathVariation,
        input.ref
      )
      successfulPath = pathVariation

      if (pathVariation !== input.path) {
        logger?.('info', 'File found using path variation', {
          originalPath: input.path,
          successfulPath: pathVariation,
          triedPaths: pathVariations.indexOf(pathVariation) + 1
        })
      }
      break // Success!
    } catch (error) {
      lastError = error as Error
      // Continue to next variation
    }
  }

  // If all variations failed, return error
  if (!fileContent || !successfulPath) {
    logger?.('error', 'File not found after trying all path variations', {
      originalPath: input.path,
      triedPaths: pathVariations,
      lastError: lastError?.message
    })
    return {
      success: false,
      error: `File not found: ${input.path}\nTried variations: ${pathVariations.join(', ')}\nLast error: ${lastError?.message || 'Unknown error'}`
    }
  }

  // Cache the explored file
  cacheExploredFile?.(successfulPath, fileContent, Date.now())

  logger?.('info', 'File explored and cached', {
    path: successfulPath,
    originalPath: input.path,
    size: fileContent.length
  })

  return {
    success: true,
    path: successfulPath,
    originalPath: input.path,
    content: fileContent
  }
}

/**
 * Execute a list_repository_files tool call
 */
export async function executeListFiles(
  input: { path?: string; ref?: string },
  deps: MCPToolDependencies
): Promise<MCPToolResult> {
  const { repositoryId, githubClient } = deps

  const files = await githubClient.listFiles(
    repositoryId,
    input.path || '',
    input.ref
  )

  return {
    success: true,
    path: input.path || '/',
    files
  }
}

/**
 * Execute an MCP tool call by name
 */
export async function executeMCPTool(
  toolName: string,
  input: any,
  deps: MCPToolDependencies
): Promise<MCPToolResult> {
  try {
    switch (toolName) {
      case 'get_repository_file':
        return await executeGetFile(input, deps)

      case 'list_repository_files':
        return await executeListFiles(input, deps)

      default:
        return {
          success: false,
          error: `Unknown tool: ${toolName}`
        }
    }
  } catch (error: any) {
    log.error({ err: error }, `❌ [Tool Execution] ${toolName} failed:`)
    return {
      success: false,
      error: error.message || String(error)
    }
  }
}
