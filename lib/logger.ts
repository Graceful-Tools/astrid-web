import pino from "pino"

/**
 * Centralized logging utility for the Astrid application.
 *
 * Uses pino for high-performance structured logging.
 *
 * Log levels (in order of severity):
 * - trace: Very detailed debugging information
 * - debug: Debugging information
 * - info: General operational information
 * - warn: Warning conditions
 * - error: Error conditions
 * - fatal: Fatal errors that require immediate attention
 *
 * In production (NODE_ENV=production), only 'info' and above are logged.
 * In development, 'debug' and above are logged.
 */

const isProduction = process.env.NODE_ENV === "production"
const isTest = process.env.NODE_ENV === "test"

// Determine log level based on environment
function getLogLevel(environment?: string): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL
  }
  if (environment ? environment === "test" : isTest) {
    return "silent"
  }
  if (environment ? environment === "production" : isProduction) {
    return "info"
  }
  return "debug"
}

/**
 * Modules that log on a hot path, quietened in PRODUCTION only.
 *
 * These were the top lines in a seven-day sample and none of them reports
 * anything actionable: sse-utils logged on every SSE connect,
 * oauth-token-manager three lines per authenticated request, and the task
 * routes a block per write (task 2e15b42f). They stay at debug in development,
 * where they are genuinely useful.
 */
const QUIET_IN_PRODUCTION = new Set([
  "sse-utils",
  "oauth-token-manager",
  "api.tasks.id",
  "mcp.task-operations",
])

/** `LOG_LEVEL_SSE_UTILS=debug` turns one module back up without touching the rest. */
function moduleOverrideEnvName(name: string): string {
  return `LOG_LEVEL_${name.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}`
}

/**
 * The level for one module.
 *
 * Exported so the policy is testable: "which modules are quiet in production"
 * is a decision worth pinning, not a comment.
 */
export function moduleLogLevel(name: string, environment?: string): string {
  const override = process.env[moduleOverrideEnvName(name)]
  if (override) return override

  const env = environment ?? process.env.NODE_ENV
  if (env === "production" && QUIET_IN_PRODUCTION.has(name)) return "warn"

  return getLogLevel(env)
}

/**
 * Values scrubbed from every log record, wherever they appear.
 *
 * The specific noisy lines are gone, but this is the part that keeps paying:
 * a future `log.info({ req })` or `log.error({ err, body })` cannot leak a
 * credential by accident (task 2e15b42f). Redaction is by PATH, so each shape
 * a credential can arrive in has to be listed.
 */
const REDACT_PATHS = [
  "authorization",
  "Authorization",
  "headers.authorization",
  "headers.Authorization",
  "headers.cookie",
  "headers.Cookie",
  'headers["x-oauth-token"]',
  'headers["x-internal-secret"]',
  'headers["x-csrf-token"]',
  "cookie",
  "cookies",
  "token",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "apiKey",
  "api_key",
  "clientSecret",
  "client_secret",
  "password",
  "secret",
  "req.headers.authorization",
  "req.headers.cookie",
  "*.token",
  "*.accessToken",
  "*.apiKey",
  "*.password",
  "*.secret",
]

// Create the base logger
const logger = pino({
  level: getLogLevel(),
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  // In production, use standard JSON output
  // In development, use pretty printing (handled by pino-pretty if installed)
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      }),
})

/**
 * Create a child logger with a specific context/module name.
 *
 * @param name - The module or context name (e.g., "GitHubClient", "SSE")
 * @returns A child logger with the context attached
 *
 * @example
 * const log = createLogger("GitHubClient")
 * log.info({ userId: "123" }, "Authenticating user")
 * log.error({ error }, "Authentication failed")
 */
export function createLogger(name: string) {
  return logger.child({ module: name }, { level: moduleLogLevel(name) })
}

// Export the base logger as well
export default logger
