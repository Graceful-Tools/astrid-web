/**
 * Task 2e15b42f — production log hygiene.
 *
 * The acceptance is that error-level volume drops to actual errors, so an
 * alert on level=error becomes meaningful. Two of these are worse than volume:
 *
 *   - the MCP "startup" banner used console.error, which Vercel classifies as
 *     error, and the HTTP transport builds a NEW server per request — so a
 *     three-line banner was the project's top error, every /mcp call;
 *   - PUT /api/tasks/[id] logged the entire request body, putting task titles
 *     and descriptions into production logs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

describe('nothing routine is logged at error level (task 2e15b42f)', () => {
  it('the MCP server does not console.error its startup banner', () => {
    const src = read('mcp/mcp-server-oauth.ts')
    const banner = src.slice(src.indexOf('private logStartup'), src.indexOf('public async startWithTransport'))

    // The comment explains WHY console.error was wrong, so match a call.
    expect(banner).not.toMatch(/console\.error\(/)
  })

  it('logs the MCP banner at most once per process', () => {
    // The HTTP transport constructs a server per request, so an unguarded
    // banner is per-request output no matter which level it uses.
    const src = read('mcp/mcp-server-oauth.ts')
    expect(src).toMatch(/bannerLogged|hasLoggedStartup|loggedStartup/)
  })
})

describe('request bodies stay out of the logs (task 2e15b42f)', () => {
  it('PUT /api/tasks/[id] does not dump the update payload', () => {
    const src = read('app/api/tasks/[id]/route.ts')

    // No log call may carry the request body or the built update object.
    expect(src).not.toMatch(/log\.\w+\(\{[^}]*\bupdateData\b[^}]*\}/s)
    // `{ data }` shorthand, in any log call.
    expect(src).not.toMatch(/log\.\w+\(\{\s*data\s*[,}]/)
  })

  it('has no [DEBUG] lines left in the task route', () => {
    // Four of them, two mislabelled DELETE inside the PUT handler.
    expect(read('app/api/tasks/[id]/route.ts')).not.toContain('[DEBUG]')
  })
})

describe('the logger redacts credentials (task 2e15b42f)', () => {
  beforeEach(() => vi.resetModules())

  it('redacts an authorization header even when something logs the whole request', () => {
    const src = read('lib/logger.ts')
    expect(src).toMatch(/redact/)
    for (const path of ['authorization', 'cookie', 'token']) {
      expect(src.toLowerCase(), `no redaction for ${path}`).toContain(path)
    }
  })
})

describe('per-module log levels (task 2e15b42f)', () => {
  it('lets a hot module be quieter than the global level', async () => {
    const { moduleLogLevel } = await import('@/lib/logger')

    // sse-utils logged a line on every SSE connect; oauth-token-manager three
    // per authenticated request.
    expect(moduleLogLevel('sse-utils', 'production')).toBe('warn')
    expect(moduleLogLevel('oauth-token-manager', 'production')).toBe('warn')
    // Everything else keeps the environment default.
    expect(moduleLogLevel('anything-else', 'production')).toBe('info')
    // A quiet default must not silence development, where these lines are useful.
    expect(moduleLogLevel('sse-utils', 'development')).toBe('debug')
  })

  it('lets LOG_LEVEL_<MODULE> override the quiet default', async () => {
    const original = process.env.LOG_LEVEL_SSE_UTILS
    try {
      process.env.LOG_LEVEL_SSE_UTILS = 'debug'
      vi.resetModules()
      const { moduleLogLevel } = await import('@/lib/logger')
      expect(moduleLogLevel('sse-utils', 'production')).toBe('debug')
    } finally {
      if (original === undefined) delete process.env.LOG_LEVEL_SSE_UTILS
      else process.env.LOG_LEVEL_SSE_UTILS = original
    }
  })
})

describe('OAuth validation stops paying per request (task 2e15b42f)', () => {
  it('does not fire a second database probe just to log why a token failed', () => {
    const src = read('lib/oauth/oauth-token-manager.ts')
    const validate = src.slice(src.indexOf('export async function validateAccessToken'))
    const probe = validate.slice(0, validate.indexOf('Token validated successfully'))

    // An expired token from a polling client bought TWO queries and three info
    // lines on every attempt.
    expect(probe).not.toContain('Token exists but invalid')
  })

  it('does not write lastUsedAt on every authenticated request', () => {
    // Row-lock contention on a handful of shared client rows during sync bursts.
    const src = read('lib/oauth/oauth-token-manager.ts')
    expect(src).toMatch(/shouldRecordClientUse|lastUsedAt.*throttl|LAST_USED_WRITE_INTERVAL/i)
  })
})
