/**
 * Log an error caught by a client error boundary, loading the logger only when there is one.
 *
 * The error boundaries are part of every route's first-load JS, and a static
 * `import { createLogger } from '@/lib/logger'` brought pino with them — about 9 KiB
 * gzipped on every page, for code that runs only after something has already gone
 * wrong (AWTD-1604). If the logger chunk itself cannot load, console.error still says so.
 */
export function logBoundaryError(moduleName: string, error: unknown, message: string): void {
  void import('@/lib/logger')
    .then(({ createLogger }) => createLogger(moduleName).error({ err: error }, message))
    .catch(() => console.error(message, error))
}
