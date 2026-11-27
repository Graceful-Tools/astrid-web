/**
 * ADEV-314: profile the hosted-MCP backend hop before deciding on an in-process dispatcher.
 * Timing is opt-in (ASTRID_MCP_TIMING); with it off nothing is logged and behaviour is unchanged.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const info = vi.hoisted(() => vi.fn())
vi.mock('@/lib/logger', async (orig) => {
  const actual = await orig<any>()
  return { ...actual, createLogger: () => ({ info, warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
})

import { OAuthAPIClient, mcpTimingEnabled } from '@/mcp/oauth-api-client'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  info.mockClear()
})

const stub = () =>
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({}) })))

describe('mcp backend hop timing (ADEV-314)', () => {
  it('is off unless ASTRID_MCP_TIMING is 1/true', () => {
    expect(mcpTimingEnabled({})).toBe(false)
    expect(mcpTimingEnabled({ ASTRID_MCP_TIMING: '1' })).toBe(true)
    expect(mcpTimingEnabled({ ASTRID_MCP_TIMING: 'true' })).toBe(true)
  })

  it('logs the hop duration for a read when enabled', async () => {
    vi.stubEnv('ASTRID_MCP_TIMING', '1')
    stub()
    await new OAuthAPIClient('https://x.test', undefined, undefined, 'tok').makeRequest('/api/v1/tasks/t')
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: '/api/v1/tasks/t', status: 200, hopMs: expect.any(Number) }),
      'mcp backend hop',
    )
  })

  it('logs nothing by default', async () => {
    stub()
    await new OAuthAPIClient('https://x.test', undefined, undefined, 'tok').makeRequest('/api/v1/tasks/t')
    expect(info).not.toHaveBeenCalled()
  })
})
