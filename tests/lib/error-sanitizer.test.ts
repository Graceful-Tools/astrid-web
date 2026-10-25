/**
 * The production error sanitizer (AWTD-1336). It had no test, and its
 * `sk-[A-Za-z0-9]+` stopped at the first hyphen — so an Anthropic key lost
 * only "sk-ant" and its secret part, "-api03-…", reached the logs.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

let sanitizeMessage: (message: string) => string

beforeAll(async () => {
  // `isProduction` is read when the module loads.
  vi.stubEnv('NODE_ENV', 'production')
  vi.resetModules()
  ;({ sanitizeMessage } = await import('@/lib/logging/error-sanitizer'))
})

afterAll(() => {
  vi.unstubAllEnvs()
})

const ANTHROPIC = 'sk-ant-api03-AbCdEf123456_ghIJkl-789mnoPQR'
const OPENAI_PROJECT = 'sk-proj-AbC123_def-456GHI'
const PLAIN = 'sk-AbCdEf1234567890'

describe('sanitizeMessage (AWTD-1336)', () => {
  it.each([
    ['an Anthropic key', ANTHROPIC],
    ['an OpenAI project key', OPENAI_PROJECT],
    ['a plain sk- key', PLAIN],
  ])('redacts the whole of %s, not just its prefix', (_name, key) => {
    const out = sanitizeMessage(`Request failed with key ${key} (401)`)
    expect(out).toBe('Request failed with key [REDACTED] (401)')
  })

  it('redacts a key inside a JSON string and in a URL query', () => {
    expect(sanitizeMessage(`body: {"api_key":"${ANTHROPIC}"}`)).not.toContain('api03')
    expect(sanitizeMessage(`GET /v1/x?key=${ANTHROPIC}&a=1`)).not.toContain('api03')
  })

  it('redacts bearer tokens, and key= / token= / password= values', () => {
    expect(sanitizeMessage('Authorization: Bearer abc.def-ghi_jkl')).not.toMatch(/abc\.def|ghi_jkl/)
    expect(sanitizeMessage('token=astrid_mcp_0123abcd')).not.toContain('0123abcd')
    expect(sanitizeMessage('password: hunter2!')).not.toContain('hunter2')
    expect(sanitizeMessage('"apiKey": "abcd-1234"')).not.toContain('abcd-1234')
  })

  it('leaves ordinary text alone', () => {
    expect(sanitizeMessage('Task not found for user 42')).toBe('Task not found for user 42')
    expect(sanitizeMessage('risk-assessment failed')).toBe('risk-assessment failed')
  })
})
