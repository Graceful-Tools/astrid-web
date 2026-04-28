import { createLogger } from '@/lib/logger'

const log = createLogger('ai.types.logger')

/**
 * Shared Logger Type for AI Services
 *
 * Provides a consistent logging interface across all AI-related modules.
 * This consolidates the identical logger types previously defined in:
 * - mcp-tool-executor.ts (MCPToolLogger)
 * - response-parser.ts (ParseLogger)
 * - repository-context-loader.ts (RepositoryContextLogger)
 * - github-workflow-service.ts (WorkflowLogger)
 * - file-validator.ts (FileValidatorLogger)
 */

/**
 * Log level for AI service logging
 */
export type AILogLevel = 'info' | 'warn' | 'error'

/**
 * Standard logger function type for AI services
 *
 * @param level - The log level ('info', 'warn', or 'error')
 * @param message - The log message
 * @param meta - Optional metadata to include with the log
 */
export type AILogger = (level: AILogLevel, message: string, meta?: unknown) => void

/**
 * Type aliases for backward compatibility
 * These map old type names to the new unified AILogger type
 */
export type MCPToolLogger = AILogger
export type ParseLogger = AILogger
export type RepositoryContextLogger = AILogger
export type WorkflowLogger = AILogger
export type FileValidatorLogger = AILogger

/**
 * Create a no-op logger (useful for testing or when logging is not needed)
 */
export const noopLogger: AILogger = () => {}

/**
 * Create a console logger that writes to stdout/stderr
 */
export function createConsoleLogger(prefix: string): AILogger {
  return (level: AILogLevel, message: string, meta?: unknown) => {
    const timestamp = new Date().toISOString()
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : ''

    switch (level) {
      case 'error':
        log.error(`[${timestamp}] [${prefix}] ERROR: ${message}${metaStr}`)
        break
      case 'warn':
        log.warn(`[${timestamp}] [${prefix}] WARN: ${message}${metaStr}`)
        break
      default:
        log.info(`[${timestamp}] [${prefix}] INFO: ${message}${metaStr}`)
    }
  }
}
