import { createLogger } from '@/lib/logger'

const log = createLogger('logging.error-sanitizer')

/**
 * Error sanitization utilities for production logging
 *
 * Prevents sensitive information from being logged in production:
 * - Strips file paths that could reveal server structure
 * - Truncates stack traces
 * - Masks potential secrets in error messages
 */

const isProduction = process.env.NODE_ENV === 'production'

// Max stack trace frames to include in production
const MAX_STACK_FRAMES = 5

// Patterns that might indicate secrets in error messages
const SECRET_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-_]+/gi,
  /sk-[A-Za-z0-9]+/gi,
  /key[=:]\s*["']?[A-Za-z0-9\-_]+["']?/gi,
  /password[=:]\s*["']?[^\s"']+["']?/gi,
  /token[=:]\s*["']?[A-Za-z0-9\-_]+["']?/gi,
]

/**
 * Sanitize a stack trace for production logging
 */
export function sanitizeStack(stack: string | undefined): string {
  if (!stack) return ''

  if (!isProduction) {
    // In development, return full stack
    return stack
  }

  const lines = stack.split('\n')
  const sanitizedLines: string[] = []

  for (const line of lines) {
    if (sanitizedLines.length >= MAX_STACK_FRAMES + 1) {
      sanitizedLines.push(`  ... ${lines.length - sanitizedLines.length} more frames truncated`)
      break
    }

    // Remove absolute file paths, keep only relative paths
    const sanitizedLine = line
      .replace(/\(\/[^:)]+:/g, '(<path>:')
      .replace(/at \/[^:]+:/g, 'at <path>:')
      .replace(/file:\/\/\/[^:]+:/g, 'file://<path>:')

    sanitizedLines.push(sanitizedLine)
  }

  return sanitizedLines.join('\n')
}

/**
 * Sanitize an error message by masking potential secrets
 */
export function sanitizeMessage(message: string): string {
  if (!isProduction) {
    return message
  }

  let sanitized = message

  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]')
  }

  return sanitized
}

/**
 * Create a sanitized error object safe for production logging
 */
export function sanitizeError(error: unknown): {
  message: string
  name: string
  stack?: string
  code?: string | number
} {
  if (error instanceof Error) {
    return {
      message: sanitizeMessage(error.message),
      name: error.name,
      stack: sanitizeStack(error.stack),
      code: (error as { code?: string | number }).code,
    }
  }

  if (typeof error === 'string') {
    return {
      message: sanitizeMessage(error),
      name: 'Error',
    }
  }

  return {
    message: 'Unknown error',
    name: 'Error',
  }
}

/**
 * Log an error with sanitization for production
 * Use this instead of console.error for sensitive contexts
 */
export function logError(context: string, error: unknown): void {
  const sanitized = sanitizeError(error)

  log.error(`[${context}] ${sanitized.name}: ${sanitized.message}`)

  if (sanitized.stack && isProduction) {
    log.error(`[${context}] Stack (sanitized): ${sanitized.stack}`)
  } else if (sanitized.stack) {
    log.error(`[${context}] Stack: ${sanitized.stack}`)
  }

  if (sanitized.code) {
    log.error(`[${context}] Code: ${sanitized.code}`)
  }
}

/**
 * Create a safe error response for API endpoints
 * Never exposes internal details to clients
 */
export function createSafeErrorResponse(
  error: unknown,
  defaultMessage = 'Internal server error'
): { error: string; details?: string } {
  if (!isProduction && error instanceof Error) {
    return {
      error: defaultMessage,
      details: error.message,
    }
  }

  return { error: defaultMessage }
}
