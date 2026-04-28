import { createLogger } from '@/lib/logger'

const log = createLogger('error-utils')

/**
 * Error Handling Utilities
 *
 * Type-safe error handling helpers to replace `catch (error: any)` patterns.
 * Use these to extract error messages and handle errors consistently.
 */

/**
 * Extract error message from unknown error type.
 * Useful for logging and error responses.
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/**
 * Extract error stack from unknown error type.
 * Returns undefined if no stack is available.
 */
export function getErrorStack(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.stack
  }
  return undefined
}

/**
 * Type guard to check if error is an Error instance.
 */
export function isError(error: unknown): error is Error {
  return error instanceof Error
}

/**
 * Type guard to check if error has a specific code property.
 * Useful for Prisma errors, Node.js errors, etc.
 */
export function hasErrorCode(error: unknown): error is { code: string } {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  )
}

/**
 * Extract Prisma error code if present.
 * Common codes: P2002 (unique constraint), P2025 (not found), etc.
 */
export function getPrismaErrorCode(error: unknown): string | undefined {
  if (hasErrorCode(error)) {
    return error.code
  }
  return undefined
}

/**
 * Safely log an error with consistent formatting.
 */
export function logError(context: string, error: unknown): void {
  log.error({ message: getErrorMessage(error) }, `❌ ${context}`)
  const stack = getErrorStack(error)
  if (stack) {
    log.error({ err: stack }, 'Stack:')
  }
}

/**
 * Create a standardized error response object.
 */
export function createErrorResponse(error: unknown, includeDetails = false): {
  error: string
  details?: string
  code?: string
} {
  const message = getErrorMessage(error)
  const code = getPrismaErrorCode(error)

  const response: { error: string; details?: string; code?: string } = {
    error: includeDetails ? message : 'Internal server error'
  }

  if (includeDetails) {
    response.details = message
  }

  if (code) {
    response.code = code
  }

  return response
}

/**
 * Re-throw error if it's an instance of specific error class.
 * Useful in catch blocks when you want to handle some errors but re-throw others.
 */
export function rethrowIfInstanceOf<T extends Error>(
  error: unknown,
  ErrorClass: new (...args: unknown[]) => T
): void {
  if (error instanceof ErrorClass) {
    throw error
  }
}
