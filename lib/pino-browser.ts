/**
 * The browser's `pino`: what lib/logger.ts needs from it, without pino's browser build.
 *
 * lib/logger.ts is imported by client components too, so pino's browser build (pino/browser.js
 * plus @pinojs/redact, ~4.2 KiB gzipped) sat in every route's first load. In the browser it only
 * ever wrote to the console. next.config.mjs aliases `pino` to this file for browser bundles;
 * the server keeps real pino (ADEV-334, to make room for tailwind-merge 3 under the initial-JS
 * ceiling).
 *
 * Kept from pino: level filtering, `child(bindings, { level })`, `isLevelEnabled`, and redaction
 * of the same REDACT_PATHS, so a credential in a log record never reaches the console either.
 */

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60, silent: Infinity } as const
type LevelName = keyof typeof LEVELS
type Method = Exclude<LevelName, 'silent'>
const METHODS: Method[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
const CONSOLE: Record<Method, 'debug' | 'info' | 'warn' | 'error'> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
}

export interface BrowserPinoOptions {
  level?: string
  redact?: { paths: string[]; censor?: string }
  [option: string]: unknown
}

type LogFn = (objOrMsg?: unknown, ...rest: unknown[]) => void

export interface BrowserLogger extends Record<Method, LogFn> {
  level: string
  isLevelEnabled(level: string): boolean
  child(bindings: Record<string, unknown>, options?: { level?: string }): BrowserLogger
}

/** `headers["x-oauth-token"]` → ['headers', 'x-oauth-token']; `*.token` → ['*', 'token']. */
function parsePath(path: string): string[] {
  const segments: string[] = []
  for (const match of path.matchAll(/([^.[\]]+)|\["([^"]+)"\]/g)) segments.push(match[1] ?? match[2])
  return segments
}

function redactAt(value: unknown, segments: string[], censor: string): unknown {
  if (value === null || typeof value !== 'object' || segments.length === 0) return value
  const [head, ...rest] = segments
  const copy: Record<string, unknown> = Array.isArray(value) ? ([...value] as unknown as Record<string, unknown>) : { ...value }
  const keys = head === '*' ? Object.keys(copy) : head in copy ? [head] : []
  for (const key of keys) copy[key] = rest.length === 0 ? censor : redactAt(copy[key], rest, censor)
  return copy
}

function makeRedactor(options?: BrowserPinoOptions['redact']): (record: unknown) => unknown {
  if (!options?.paths?.length) return (record) => record
  const paths = options.paths.map(parsePath)
  const censor = options.censor ?? '[Redacted]'
  return (record) => paths.reduce((acc, segments) => redactAt(acc, segments, censor), record)
}

function levelValue(level: string): number {
  return LEVELS[level as LevelName] ?? LEVELS.info
}

function makeLogger(level: string, bindings: Record<string, unknown>, redact: (record: unknown) => unknown): BrowserLogger {
  const logger = {
    level,
    isLevelEnabled: (name: string) => levelValue(name) >= levelValue(logger.level),
    child: (childBindings: Record<string, unknown>, options?: { level?: string }) =>
      makeLogger(options?.level ?? logger.level, { ...bindings, ...childBindings }, redact),
  } as BrowserLogger
  for (const method of METHODS) {
    logger[method] = (objOrMsg?: unknown, ...rest: unknown[]) => {
      if (!logger.isLevelEnabled(method)) return
      const prefix = typeof bindings.module === 'string' ? [`[${bindings.module}]`] : []
      const record = objOrMsg !== null && typeof objOrMsg === 'object' && !(objOrMsg instanceof Error) ? redact(objOrMsg) : objOrMsg
      console[CONSOLE[method]](...prefix, record, ...rest)
    }
  }
  return logger
}

function pino(options: BrowserPinoOptions = {}): BrowserLogger {
  return makeLogger(options.level ?? 'info', {}, makeRedactor(options.redact))
}

/** Server-only in real pino; lib/logger.ts only calls it under LOG_TO_STDERR. */
pino.destination = (_fd?: number): undefined => undefined

export default pino
