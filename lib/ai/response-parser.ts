/**
 * AI Response Parser Utilities
 *
 * Pure utility functions for parsing AI responses.
 * Used by the AI Orchestrator to extract structured data from raw AI output.
 */

import type { ParseLogger } from './types/logger'
import type { ImplementationPlan } from './types'

// Re-export for backward compatibility
export type { ParseLogger }

/**
 * Extract a complete JSON object from a response using balanced brace matching.
 * This handles nested objects and arrays properly.
 *
 * @param response - The raw AI response text
 * @returns The extracted JSON string, or null if not found
 */
export function extractBalancedJson(response: string): string | null {
  // Find the first opening brace that might start a JSON object
  const startIndex = response.indexOf('{')
  if (startIndex === -1) return null

  let braceCount = 0
  let inString = false
  let escapeNext = false

  for (let i = startIndex; i < response.length; i++) {
    const char = response[i]

    // Handle escape sequences in strings
    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    // Toggle string state
    if (char === '"' && !escapeNext) {
      inString = !inString
      continue
    }

    // Only count braces outside of strings
    if (!inString) {
      if (char === '{') {
        braceCount++
      } else if (char === '}') {
        braceCount--

        // Found matching closing brace
        if (braceCount === 0) {
          const jsonStr = response.substring(startIndex, i + 1)
          // Quick validation: check if it looks like it has the expected structure
          if (jsonStr.includes('"files"')) {
            return jsonStr
          }
        }
      }
    }
  }

  return null
}

/**
 * Count the balance of braces in a string (for debugging).
 * Returns positive if more opening braces, negative if more closing, 0 if balanced.
 *
 * @param text - The text to analyze
 * @returns The brace balance count
 */
export function countBraceBalance(text: string): number {
  let balance = 0
  let inString = false
  let escapeNext = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]

    if (escapeNext) {
      escapeNext = false
      continue
    }

    if (char === '\\') {
      escapeNext = true
      continue
    }

    if (char === '"' && !escapeNext) {
      inString = !inString
      continue
    }

    if (!inString) {
      if (char === '{') balance++
      else if (char === '}') balance--
    }
  }

  return balance
}

/**
 * Extract a labeled section from an AI response.
 *
 * @param response - The raw AI response text
 * @param section - The section label to find (e.g., "SUMMARY", "APPROACH")
 * @returns The section content, or null if not found
 */
export function extractSection(response: string, section: string): string | null {
  const regex = new RegExp(`${section}:?\\s*([\\s\\S]*?)(?=\\n\\n|\\n[A-Z]|$)`, 'i')
  const match = response.match(regex)
  return match ? match[1].trim() : null
}

/**
 * Assess the complexity of a task based on response characteristics.
 *
 * @param response - The raw AI response text
 * @returns The complexity assessment
 */
export function assessComplexity(response: string): 'simple' | 'medium' | 'complex' {
  const wordCount = response.split(' ').length
  const fileCount = (response.match(/\.(tsx?|jsx?|css|json)/gi) || []).length

  if (wordCount < 200 && fileCount <= 2) return 'simple'
  if (wordCount < 500 && fileCount <= 5) return 'medium'
  return 'complex'
}

/**
 * Extract considerations (bullet points) from an AI response.
 *
 * @param response - The raw AI response text
 * @param maxCount - Maximum number of considerations to return (default: 5)
 * @returns Array of consideration strings
 */
export function extractConsiderations(response: string, maxCount: number = 5): string[] {
  const considerations: string[] = []

  // Look for bullet points or numbered lists
  const bulletMatches = response.match(/[•\-\*]\s*([^\n]+)/g)
  if (bulletMatches) {
    considerations.push(...bulletMatches.map(match => match.replace(/[•\-\*]\s*/, '')))
  }

  return considerations.slice(0, maxCount)
}

/**
 * Extract file path mentions from an AI response.
 * This extracts paths from patterns like "modify `path/to/file.ts`".
 *
 * @param response - The raw AI response text
 * @returns Array of extracted file paths
 */
export function extractFilePaths(response: string): string[] {
  const fileMatches = response.match(/(?:create|modify|update)?\s*`?([a-zA-Z0-9/_.-]+\.(tsx?|jsx?|css|json))`?/gi)

  if (!fileMatches) return []

  return fileMatches.map(match =>
    match.replace(/(?:create|modify|update)?\s*`?/gi, '').replace(/`/g, '')
  )
}

/**
 * Map a file path to a similar path from a list of known paths.
 * Handles kebab-case vs camelCase differences.
 *
 * @param path - The path to map
 * @param knownPaths - Array of known/explored paths
 * @returns The matched path, or the original if no match found
 */
export function mapToKnownPath(path: string, knownPaths: string[]): string {
  // Try exact match first
  if (knownPaths.includes(path)) {
    return path
  }

  // Try to find a similar path (e.g., use-task-operations.ts → useTaskOperations.ts)
  const baseName = path.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') || ''

  const matchedPath = knownPaths.find(explored => {
    const exploredBaseName = explored.split('/').pop()?.replace(/\.(tsx?|jsx?)$/, '') || ''
    // Match if base names are similar (ignoring case and dashes)
    return exploredBaseName.toLowerCase().replace(/-/g, '') === baseName.toLowerCase().replace(/-/g, '')
  })

  return matchedPath || path
}

/**
 * Result of extracting code from markdown
 */
export interface ExtractedCodeFile {
  path: string
  content: string
  action: 'create' | 'modify' | 'delete'
}

/**
 * Extract code files from markdown-formatted AI response.
 * Tries multiple patterns to find file paths and their associated code blocks.
 *
 * @param response - The raw AI response text
 * @returns Array of extracted code files
 * @throws Error with 'RETRY_WITH_FORMAT_ENFORCEMENT' if no files could be extracted
 */
export function extractCodeFromMarkdown(response: string): ExtractedCodeFile[] {
  const files: ExtractedCodeFile[] = []

  // Pattern 1: ### File: `path/to/file.ts` followed by code block
  const fileHeaderPattern = /###\s*File:\s*`([^`]+)`\s*```(?:typescript|tsx?|jsx?|javascript)?\s*\n([\s\S]*?)```/g
  let match

  while ((match = fileHeaderPattern.exec(response)) !== null) {
    files.push({
      path: match[1],
      content: match[2].trim(),
      action: 'modify'
    })
  }

  // Pattern 2: Code block with // filepath comment
  if (files.length === 0) {
    const commentPattern = /```(?:typescript|tsx?|jsx?|javascript)?\s*(?:\/\/\s*(.+))?\n([\s\S]*?)```/g
    while ((match = commentPattern.exec(response)) !== null) {
      if (match[1]) { // Only if we found a file path
        files.push({
          path: match[1],
          content: match[2].trim(),
          action: 'create'
        })
      }
    }
  }

  // Pattern 3: Look for file paths in text like "file: path/to/file.ts"
  if (files.length === 0) {
    const pathInTextPattern = /(?:file|path):\s*`?([a-zA-Z0-9/_.-]+\.(?:tsx?|jsx?|js|css|json))`?/gi
    const paths = [...response.matchAll(pathInTextPattern)].map(m => m[1])

    // Extract code blocks without file paths and match them with found paths
    const codeBlockPattern = /```(?:typescript|tsx?|jsx?|javascript)?\s*\n([\s\S]*?)```/g
    const codeBlocks: string[] = []
    while ((match = codeBlockPattern.exec(response)) !== null) {
      codeBlocks.push(match[1].trim())
    }

    paths.forEach((path, idx) => {
      if (codeBlocks[idx]) {
        files.push({
          path,
          content: codeBlocks[idx],
          action: 'modify'
        })
      }
    })
  }

  // If we couldn't extract files with paths, throw error to signal retry needed
  if (files.length === 0) {
    throw new Error('RETRY_WITH_FORMAT_ENFORCEMENT')
  }

  return files
}

/**
 * Generated code structure from AI response
 */
export interface GeneratedCodeResponse {
  files: Array<{
    path: string
    content: string
    action: 'create' | 'modify' | 'delete'
    isPartial?: boolean
  }>
  commitMessage: string
  prTitle: string
  prDescription: string
}

/**
 * Parse AI response into generated code structure.
 * Tries multiple extraction methods to handle various AI response formats.
 *
 * @param response - The raw AI response text
 * @param logger - Optional logger callback for debugging
 * @returns The parsed generated code structure
 * @throws Error with 'RETRY_WITH_FORMAT_ENFORCEMENT' if parsing fails
 */
export function parseGeneratedCode(
  response: string,
  logger?: ParseLogger
): GeneratedCodeResponse {
  logger?.('info', 'Attempting to parse AI response', {
    responseLength: response.length,
    startsWithBrace: response.trim().startsWith('{'),
    endsWithBrace: response.trim().endsWith('}'),
    preview: response.substring(0, 100)
  })

  try {
    // Try to parse as JSON first
    const parsed = JSON.parse(response)
    logger?.('info', 'Successfully parsed response as pure JSON')
    return parsed
  } catch (parseError) {
    logger?.('warn', 'Failed to parse as pure JSON, trying extraction methods', {
      error: parseError instanceof Error ? parseError.message : String(parseError)
    })

    // Method 1: Try to extract JSON from markdown code blocks
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)```/)
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1])
        logger?.('info', 'AI returned JSON wrapped in markdown code block, extracted successfully')
        return parsed
      } catch (innerError) {
        logger?.('warn', 'Found JSON code block but failed to parse', {
          jsonContent: jsonMatch[1].substring(0, 200),
          error: innerError instanceof Error ? innerError.message : String(innerError)
        })
      }
    }

    // Method 2: Use balanced brace extraction to find complete JSON object
    const balancedJson = extractBalancedJson(response)
    if (balancedJson) {
      try {
        const parsed = JSON.parse(balancedJson)
        if (parsed.files && Array.isArray(parsed.files)) {
          logger?.('info', 'Extracted valid JSON using balanced brace matching')
          return parsed
        } else {
          logger?.('warn', 'Balanced JSON found but missing "files" array', {
            keys: Object.keys(parsed),
            preview: balancedJson.substring(0, 200)
          })
        }
      } catch (innerError) {
        logger?.('warn', 'Found balanced braces but content is not valid JSON', {
          preview: balancedJson.substring(0, 200),
          error: innerError instanceof Error ? innerError.message : String(innerError)
        })
      }
    }

    // Method 3: Try to find JSON object anywhere in response (look for "files" key)
    const jsonObjectMatch = response.match(/\{[\s\S]*?"files"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/)
    if (jsonObjectMatch) {
      try {
        const parsed = JSON.parse(jsonObjectMatch[0])
        logger?.('info', 'Found JSON object with "files" key in response text, extracted successfully')
        return parsed
      } catch (innerError) {
        logger?.('warn', 'Found JSON-like object but failed to parse', {
          jsonContent: jsonObjectMatch[0].substring(0, 200),
          error: innerError instanceof Error ? innerError.message : String(innerError)
        })
      }
    }

    // Method 4: Try to extract JSON between first { and last }
    const firstBrace = response.indexOf('{')
    const lastBrace = response.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const potentialJson = response.substring(firstBrace, lastBrace + 1)
      try {
        const parsed = JSON.parse(potentialJson)
        if (parsed.files && Array.isArray(parsed.files)) {
          logger?.('info', 'Extracted JSON from between first { and last }, validated structure')
          return parsed
        }
      } catch (innerError) {
        logger?.('warn', 'Found braces but content between them is not valid JSON', {
          preview: potentialJson.substring(0, 200),
          error: innerError instanceof Error ? innerError.message : String(innerError)
        })
      }
    }

    // Method 5: Last resort - try to extract from markdown with file path detection
    logger?.('warn', 'All JSON parsing methods failed, falling back to markdown extraction', {
      responseStart: response.substring(0, 500),
      hasCodeBlocks: response.includes('```'),
      hasFileHeaders: response.includes('### File:') || response.includes('## File:'),
      hasFiles: response.includes('"files"'),
      hasBraces: response.includes('{') && response.includes('}')
    })

    try {
      const files = extractCodeFromMarkdown(response)
      logger?.('info', 'Extracted files from markdown', {
        filesExtracted: files.length,
        paths: files.map(f => f.path)
      })
      return {
        files,
        commitMessage: 'Implement feature as requested',
        prTitle: 'Implement new feature',
        prDescription: 'Automated implementation by Astrid Agent'
      }
    } catch (extractError) {
      // extractCodeFromMarkdown throws RETRY_WITH_FORMAT_ENFORCEMENT if no files found
      logger?.('warn', 'Failed to extract files from AI response, will retry with format enforcement', {
        responseLength: response.length,
        responsePreview: response.substring(0, 500)
      })
      throw extractError
    }
  }
}

/**
 * Parse an AI planning response into an ImplementationPlan.
 *
 * AI responses sometimes name files by paths the orchestrator never
 * actually explored — `knownPaths` is the set of files the caller has
 * loaded so far, and any "close-but-not-quite" path the AI returns is
 * mapped onto the matching real path via `mapToKnownPath` (e.g. the AI
 * says `src/foo.tsx` but only `app/foo.tsx` was explored).
 */
export function parseImplementationPlan(
  response: string,
  knownPaths: string[],
  logger?: ParseLogger,
): ImplementationPlan {
  const filePaths = extractFilePaths(response)
  const files = filePaths.map(path => {
    const mappedPath = mapToKnownPath(path, knownPaths)
    if (mappedPath !== path) {
      logger?.('info', 'Mapped AI hallucinated path to actual explored file', {
        aiPath: path,
        actualPath: mappedPath,
      })
    }
    return {
      path: mappedPath,
      purpose: 'Component file',
      changes: 'Create/modify component',
    }
  })

  return {
    summary: extractSection(response, 'summary') || 'Implementation plan generated',
    approach: extractSection(response, 'approach') || response.substring(0, 200),
    files,
    estimatedComplexity: assessComplexity(response),
    considerations: extractConsiderations(response),
  }
}
