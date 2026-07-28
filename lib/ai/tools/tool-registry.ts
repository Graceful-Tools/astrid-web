/**
 * Tool Registry
 *
 * Centralized tool definitions for all AI providers.
 * Each provider has its own format for tool declarations.
 */

import { BRAND } from '@/lib/brand/config'
import * as fs from 'fs/promises'
import * as path from 'path'
import { execSync } from 'child_process'
import { glob } from 'glob'
import type { ResolvedAstridConfig, ToolConfig } from '../config/schema'
import { isBlockedCommand } from '../config'

// ============================================================================
// TOOL TYPES
// ============================================================================

export interface ToolExecutionResult {
  success: boolean
  result: string
  error?: string
}

export type AIProvider = 'claude' | 'openai' | 'gemini'

// ============================================================================
// CLAUDE TOOL DEFINITIONS
// ============================================================================

/**
 * Claude uses native SDK tools - just names for allowedTools
 */
export const CLAUDE_TOOLS = {
  planning: ['Read', 'Glob', 'Grep', 'Bash'],
  execution: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
}

// ============================================================================
// OPENAI TOOL DEFINITIONS
// ============================================================================

export const OPENAI_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given path',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to read' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Write content to a file, creating it if it does not exist',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to write' },
          content: { type: 'string', description: 'Content to write to the file' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description: 'Edit a file by replacing a specific string with new content',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the file to edit' },
          old_string: { type: 'string', description: 'The exact string to find and replace' },
          new_string: { type: 'string', description: 'The string to replace it with' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'glob_files',
      description: 'Find files matching a glob pattern',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.js")' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'grep_search',
      description: 'Search for a pattern in files',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (regex supported)' },
          file_pattern: { type: 'string', description: 'File pattern to search in (e.g., "*.ts")' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_bash',
      description: 'Run a bash command and return its output',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'task_complete',
      description: 'Signal that the task is complete with commit details',
      parameters: {
        type: 'object',
        properties: {
          commit_message: { type: 'string', description: 'Commit message for the changes' },
          pr_title: { type: 'string', description: 'Pull request title' },
          pr_description: { type: 'string', description: 'Pull request description' },
        },
        required: ['commit_message', 'pr_title', 'pr_description'],
      },
    },
  },
]

// ============================================================================
// GEMINI TOOL DEFINITIONS
// ============================================================================

export const GEMINI_TOOL_DECLARATIONS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to read' },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file, creating it if it does not exist',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to write' },
        content: { type: 'string', description: 'Content to write to the file' },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Edit a file by replacing a specific string with new content',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit' },
        old_string: { type: 'string', description: 'The exact string to find and replace' },
        new_string: { type: 'string', description: 'The string to replace it with' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'glob_files',
    description: 'Find files matching a glob pattern',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts", "src/**/*.js")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep_search',
    description: 'Search for a pattern in files',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern (regex supported)' },
        file_pattern: { type: 'string', description: 'File pattern to search in (e.g., "*.ts")' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'run_bash',
    description: 'Run a bash command and return its output',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to run' },
      },
      required: ['command'],
    },
  },
  {
    name: 'task_complete',
    description: 'Signal that the task is complete with commit details',
    parameters: {
      type: 'object',
      properties: {
        commit_message: { type: 'string', description: 'Commit message for the changes' },
        pr_title: { type: 'string', description: 'Pull request title' },
        pr_description: { type: 'string', description: 'Pull request description' },
      },
      required: ['commit_message', 'pr_title', 'pr_description'],
    },
  },
]

// ============================================================================
// GET TOOLS FOR PROVIDER
// ============================================================================

/**
 * Get tool definitions for a provider, filtered by allowed tools
 */
export function getToolsForProvider(
  provider: AIProvider,
  allowedTools: ToolConfig[],
  phase: 'planning' | 'execution'
): unknown[] {
  const enabledNames = allowedTools
    .filter(t => t.enabled !== false)
    .map(t => t.name.toLowerCase())

  switch (provider) {
    case 'claude':
      // Claude uses native tool names
      return CLAUDE_TOOLS[phase].filter(name =>
        enabledNames.includes(name.toLowerCase())
      )

    case 'openai':
      return OPENAI_TOOL_DEFINITIONS.filter(tool =>
        enabledNames.includes(tool.function.name.toLowerCase()) ||
        enabledNames.includes(mapToolName(tool.function.name).toLowerCase())
      )

    case 'gemini':
      return GEMINI_TOOL_DECLARATIONS.filter(tool =>
        enabledNames.includes(tool.name.toLowerCase()) ||
        enabledNames.includes(mapToolName(tool.name).toLowerCase())
      )
  }
}

/**
 * Map between Claude tool names and function names
 */
function mapToolName(name: string): string {
  const mapping: Record<string, string> = {
    read_file: 'Read',
    write_file: 'Write',
    edit_file: 'Edit',
    glob_files: 'Glob',
    grep_search: 'Grep',
    run_bash: 'Bash',
    Read: 'read_file',
    Write: 'write_file',
    Edit: 'edit_file',
    Glob: 'glob_files',
    Grep: 'grep_search',
    Bash: 'run_bash',
  }
  return mapping[name] || name
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

/**
 * Execute a tool call
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  repoPath: string,
  config: ResolvedAstridConfig
): Promise<ToolExecutionResult> {
  const name = toolName.toLowerCase()

  try {
    switch (name) {
      case 'read_file':
      case 'read':
        return await executeReadFile(args, repoPath)

      case 'write_file':
      case 'write':
        return await executeWriteFile(args, repoPath, config)

      case 'edit_file':
      case 'edit':
        return await executeEditFile(args, repoPath, config)

      case 'glob_files':
      case 'glob':
        return await executeGlobFiles(args, repoPath, config)

      case 'grep_search':
      case 'grep':
        return await executeGrepSearch(args, repoPath, config)

      case 'run_bash':
      case 'bash':
        return await executeRunBash(args, repoPath, config)

      case 'task_complete':
        return executeTaskComplete(args)

      default:
        return { success: false, result: '', error: `Unknown tool: ${toolName}` }
    }
  } catch (error) {
    return {
      success: false,
      result: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

// ============================================================================
// INDIVIDUAL TOOL IMPLEMENTATIONS
// ============================================================================

async function executeReadFile(
  args: Record<string, unknown>,
  repoPath: string
): Promise<ToolExecutionResult> {
  const filePath = args.file_path as string
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath)

  try {
    const content = await fs.readFile(fullPath, 'utf-8')
    return { success: true, result: content }
  } catch (error) {
    return {
      success: false,
      result: '',
      error: `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function executeWriteFile(
  args: Record<string, unknown>,
  repoPath: string,
  config: ResolvedAstridConfig
): Promise<ToolExecutionResult> {
  const filePath = args.file_path as string
  const content = args.content as string
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath)

  // Check protected paths
  if (config.safety.enforceProtectedPaths) {
    const { isProtectedPath } = await import('../config')
    if (isProtectedPath(filePath, config)) {
      return {
        success: false,
        result: '',
        error: `Cannot write to protected path: ${filePath}`,
      }
    }
  }

  // Check file size
  if (content.length > config.validation.maxModificationSize) {
    return {
      success: false,
      result: '',
      error: `File content exceeds max size (${config.validation.maxModificationSize} bytes)`,
    }
  }

  try {
    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    await fs.writeFile(fullPath, content, 'utf-8')
    return { success: true, result: `Successfully wrote ${filePath}` }
  } catch (error) {
    return {
      success: false,
      result: '',
      error: `Failed to write ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/**
 * Normalize whitespace in a string for fuzzy matching
 * - Trims trailing whitespace from lines
 * - Normalizes line endings to \n
 * - Collapses multiple blank lines
 */
function normalizeWhitespace(str: string): string {
  return str
    .replace(/\r\n/g, '\n')           // Normalize line endings
    .replace(/[ \t]+$/gm, '')         // Trim trailing whitespace from lines
    .replace(/\n{3,}/g, '\n\n')       // Collapse multiple blank lines
}

/**
 * Find the best match for a string in content, trying multiple strategies:
 * 1. Exact match
 * 2. Normalized whitespace match
 * 3. First line anchor match (find by first few lines)
 */
function findBestMatch(content: string, searchStr: string): { found: boolean; matchedStr?: string; strategy?: string } {
  // Strategy 1: Exact match
  if (content.includes(searchStr)) {
    return { found: true, matchedStr: searchStr, strategy: 'exact' }
  }

  // Strategy 2: Normalized whitespace match
  const normalizedContent = normalizeWhitespace(content)
  const normalizedSearch = normalizeWhitespace(searchStr)

  if (normalizedContent.includes(normalizedSearch)) {
    // Find the original string in content that matches the normalized version
    const lines = searchStr.split('\n')
    const firstLine = lines[0].trim()

    if (firstLine.length > 10) {
      // Find where the first line starts in content
      const contentLines = content.split('\n')
      for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].trim() === firstLine) {
          // Extract the matching section from content
          const matchedLines = contentLines.slice(i, i + lines.length)
          const matchedStr = matchedLines.join('\n')
          if (normalizeWhitespace(matchedStr) === normalizedSearch) {
            return { found: true, matchedStr, strategy: 'normalized' }
          }
        }
      }
    }

    return { found: true, matchedStr: searchStr, strategy: 'normalized-fallback' }
  }

  // Strategy 3: First line anchor match (for when only part of the string is wrong)
  const searchLines = searchStr.split('\n')
  if (searchLines.length >= 2) {
    const firstTrimmed = searchLines[0].trim()
    const lastTrimmed = searchLines[searchLines.length - 1].trim()

    if (firstTrimmed.length > 15 && lastTrimmed.length > 10) {
      const contentLines = content.split('\n')
      for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].trim() === firstTrimmed) {
          // Look for the last line within reasonable range
          const maxEndLine = Math.min(i + searchLines.length + 5, contentLines.length)
          for (let j = i + 1; j < maxEndLine; j++) {
            if (contentLines[j].trim() === lastTrimmed) {
              const matchedStr = contentLines.slice(i, j + 1).join('\n')
              return { found: true, matchedStr, strategy: 'anchor' }
            }
          }
        }
      }
    }
  }

  return { found: false }
}

async function executeEditFile(
  args: Record<string, unknown>,
  repoPath: string,
  config: ResolvedAstridConfig
): Promise<ToolExecutionResult> {
  const filePath = args.file_path as string
  const oldString = args.old_string as string
  const newString = args.new_string as string
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(repoPath, filePath)

  // Check protected paths
  if (config.safety.enforceProtectedPaths) {
    const { isProtectedPath } = await import('../config')
    if (isProtectedPath(filePath, config)) {
      return {
        success: false,
        result: '',
        error: `Cannot edit protected path: ${filePath}`,
      }
    }
  }

  try {
    const content = await fs.readFile(fullPath, 'utf-8')

    // Try to find the best match using multiple strategies
    const match = findBestMatch(content, oldString)

    if (!match.found || !match.matchedStr) {
      // Provide helpful error with context
      const searchPreview = oldString.substring(0, 100).replace(/\n/g, '\\n')
      const firstLine = oldString.split('\n')[0].trim()

      // Try to find similar content to help debug
      let hint = ''
      if (firstLine.length > 10) {
        const contentLines = content.split('\n')
        for (let i = 0; i < contentLines.length; i++) {
          if (contentLines[i].includes(firstLine.substring(0, 20))) {
            hint = `\nHint: Line ${i + 1} contains similar text: "${contentLines[i].substring(0, 60)}..."`
            break
          }
        }
      }

      return {
        success: false,
        result: '',
        error: `String not found in file. Searched for: "${searchPreview}..."${hint}\n\nTip: Read the file first to get the exact content, then use edit_file with the precise string.`,
      }
    }

    // Apply the edit using the matched string
    const newContent = content.replace(match.matchedStr, newString)

    // Verify the edit actually changed something
    if (newContent === content) {
      return {
        success: false,
        result: '',
        error: 'Edit would result in no changes. The old_string and new_string may be identical.',
      }
    }

    await fs.writeFile(fullPath, newContent, 'utf-8')
    return {
      success: true,
      result: `Successfully edited ${filePath}${match.strategy !== 'exact' ? ` (matched using ${match.strategy} strategy)` : ''}`
    }
  } catch (error) {
    return {
      success: false,
      result: '',
      error: `Failed to edit ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function executeGlobFiles(
  args: Record<string, unknown>,
  repoPath: string,
  config: ResolvedAstridConfig
): Promise<ToolExecutionResult> {
  const pattern = args.pattern as string

  try {
    const files = await glob(pattern, {
      cwd: repoPath,
      nodir: true,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
    })

    const limited = files.slice(0, config.validation.maxGlobResults)
    const result = limited.join('\n')

    if (files.length > config.validation.maxGlobResults) {
      return {
        success: true,
        result: `${result}\n\n(Showing ${config.validation.maxGlobResults} of ${files.length} matches)`,
      }
    }

    return { success: true, result: result || 'No files found' }
  } catch (error) {
    return {
      success: false,
      result: '',
      error: `Glob failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function executeGrepSearch(
  args: Record<string, unknown>,
  repoPath: string,
  config: ResolvedAstridConfig
): Promise<ToolExecutionResult> {
  const pattern = args.pattern as string
  const filePattern = (args.file_pattern as string) || '*'

  try {
    const result = execSync(
      `grep -r -n --include="${filePattern}" "${pattern}" . 2>/dev/null | head -${config.validation.maxGlobResults}`,
      {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 30000,
      }
    )
    return { success: true, result: result || 'No matches found' }
  } catch {
    // grep returns exit code 1 when no matches found
    return { success: true, result: 'No matches found' }
  }
}

/**
 * Check if a command has balanced quotes
 */
function hasBalancedQuotes(cmd: string): { balanced: boolean; issue?: string } {
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (char === '\\') {
      escaped = true
      continue
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (char === "'" && !inDouble) {
      inSingle = !inSingle
    }
  }

  if (inSingle) {
    return { balanced: false, issue: 'Unmatched single quote' }
  }
  if (inDouble) {
    return { balanced: false, issue: 'Unmatched double quote' }
  }
  return { balanced: true }
}

/**
 * Attempt to fix common quote issues in commands
 */
function sanitizeCommand(cmd: string): string {
  // Fix common AI-generated quote issues
  let fixed = cmd

  // Replace smart quotes with regular quotes
  fixed = fixed.replace(/[""]/g, '"').replace(/['']/g, "'")

  // Fix `"Astrid App"` -> "Astrid App" (curly quotes to straight)
  fixed = fixed.replace(/[`]/g, '')

  return fixed
}

async function executeRunBash(
  args: Record<string, unknown>,
  repoPath: string,
  config: ResolvedAstridConfig
): Promise<ToolExecutionResult> {
  let command = args.command as string

  // Check blocked commands
  if (isBlockedCommand(command, config)) {
    return {
      success: false,
      result: '',
      error: 'Command blocked by safety policy',
    }
  }

  // Sanitize the command first
  command = sanitizeCommand(command)

  // Check for balanced quotes
  const quoteCheck = hasBalancedQuotes(command)
  if (!quoteCheck.balanced) {
    return {
      success: false,
      result: '',
      error: `Command has syntax error: ${quoteCheck.issue}. Please fix the quoting in the command: ${command.substring(0, 100)}...`,
    }
  }

  try {
    const result = execSync(command, {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 1024 * 1024, // 1MB
      shell: '/bin/bash',
    })
    return { success: true, result }
  } catch (error) {
    const execError = error as { stderr?: string; stdout?: string; message?: string }

    // Provide more helpful error messages for common issues
    const stderr = execError.stderr || ''
    let errorMessage = execError.message || String(error)

    // Detect xcodebuild errors and provide helpful hints
    if (stderr.includes('Unknown build action') || errorMessage.includes('Unknown build action')) {
      errorMessage += '\n\nHint: xcodebuild commands need proper quoting for scheme names with spaces. Use: -scheme "${BRAND.appName} App" (with straight quotes, not curly)'
    }

    return {
      success: false,
      result: execError.stdout || stderr,
      error: errorMessage,
    }
  }
}

function executeTaskComplete(args: Record<string, unknown>): ToolExecutionResult {
  // Just return the args - the executor handles this specially
  return {
    success: true,
    result: JSON.stringify({
      commitMessage: args.commit_message,
      prTitle: args.pr_title,
      prDescription: args.pr_description,
    }),
  }
}
