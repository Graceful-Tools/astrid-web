/**
 * ADEV-334: browser bundles alias `pino` to lib/pino-browser.ts (next.config.mjs) to keep pino's
 * browser build out of every route's first load. It must keep what lib/logger.ts relies on:
 * level filtering, child bindings and levels, isLevelEnabled, and redaction of credentials.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import pino from '@/lib/pino-browser'

afterEach(() => vi.restoreAllMocks())

describe('browser pino (ADEV-334)', () => {
  it('filters by level and maps levels to console methods', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = pino({ level: 'info' })
    log.debug('hidden')
    log.info({ a: 1 }, 'shown')
    log.fatal('fatal goes to error')
    expect(debug).not.toHaveBeenCalled()
    expect(info).toHaveBeenCalledWith({ a: 1 }, 'shown')
    expect(error).toHaveBeenCalledWith('fatal goes to error')
    expect(log.isLevelEnabled('warn')).toBe(true)
    expect(log.isLevelEnabled('debug')).toBe(false)
  })

  it('a child carries its module and its own level, as createLogger uses it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const child = pino({ level: 'info' }).child({ module: 'sse-utils' }, { level: 'warn' })
    child.info('quiet')
    child.warn({ id: 'x' }, 'loud')
    expect(info).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('[sse-utils]', { id: 'x' }, 'loud')
  })

  it('silent logs nothing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    pino({ level: 'silent' }).error('nope')
    expect(error).not.toHaveBeenCalled()
  })

  it('redacts the logger paths without mutating the caller object', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = pino({
      level: 'info',
      redact: { paths: ['token', 'headers.authorization', 'headers["x-oauth-token"]', '*.password'], censor: '[redacted]' },
    })
    const record = { token: 't', headers: { authorization: 'Bearer x', 'x-oauth-token': 'o', accept: 'json' }, user: { password: 'p', name: 'n' } }
    log.info(record, 'msg')
    expect(info).toHaveBeenCalledWith(
      { token: '[redacted]', headers: { authorization: '[redacted]', 'x-oauth-token': '[redacted]', accept: 'json' }, user: { password: '[redacted]', name: 'n' } },
      'msg',
    )
    expect(record.token).toBe('t')
  })

  it('passes an Error through untouched', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const err = new Error('boom')
    pino().error(err, 'failed')
    expect(error).toHaveBeenCalledWith(err, 'failed')
  })

  it('is what browser bundles get for pino', async () => {
    const { default: nextConfig } = await import('@/next.config.mjs')
    const aliases = (nextConfig as { turbopack?: { resolveAlias?: Record<string, unknown> } }).turbopack?.resolveAlias
    expect(aliases?.pino).toEqual({ browser: './lib/pino-browser.ts' })
  })
})
