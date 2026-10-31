/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LookupAddress } from 'node:dns'
import { Agent } from 'undici'
import { brandOrigin } from '@/lib/brand/config'
import { validateMCPAuthContext } from '@/lib/server/mcp-http-utils'
import { OAuthAPIClient } from '@/mcp/oauth-api-client'
import { fetchMCPBackend } from '@/lib/security/mcp-backend'

const lookup = vi.hoisted(() => vi.fn<() => Promise<LookupAddress[]>>())
vi.mock('node:dns/promises', () => ({ lookup }))
vi.mock('undici', () => ({
  Agent: vi.fn(function () { return { close: vi.fn().mockResolvedValue(undefined) } }),
}))
vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  UnauthorizedError: class extends Error {},
}))

beforeEach(() => {
  vi.clearAllMocks()
  lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('AITD-447 hosted MCP outbound backend safety', () => {
  it.each([
    'http://127.0.0.1', 'https://127.0.0.1', 'https://169.254.169.254',
    'https://10.0.0.1', 'https://[::1]', 'https://[fd00::1]',
    'https://[::127.0.0.1]', 'https://[fec0::1]', 'https://[2002:7f00:1::]',
    'https://[::ffff:127.0.0.1]', 'https://user:fixture@public.example',
    'https://public.example/private-info#', 'https://public.example?path=',
  ])('rejects unsafe backend %s before validation or Basic dispatch', async baseUrl => {
    for (const credentials of [
      { accessToken: 'fixture-not-real' },
      { clientId: 'fixture-client', clientSecret: 'fixture-secret' },
    ]) {
      await expect(validateMCPAuthContext({ ...credentials, baseUrl }, brandOrigin()))
        .rejects.toThrow()
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    { addresses: [{ address: '127.0.0.1', family: 4 }] },
    { addresses: [{ address: '0:0:0:0:0:0:0:1', family: 6 }] },
    { addresses: [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] },
  ])('rejects private or mixed DNS answers before sending credentials', async ({ addresses }) => {
    lookup.mockResolvedValue(addresses)
    await expect(validateMCPAuthContext({
      accessToken: 'fixture-not-real', baseUrl: 'https://public.example',
    }, brandOrigin())).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('pins the checked DNS answer and preserves public cross-deployment validation', async () => {
    await validateMCPAuthContext({
      accessToken: 'fixture-not-real', baseUrl: 'https://public.example/backend',
    }, brandOrigin())
    const connect = vi.mocked(Agent).mock.calls[0][0]?.connect
    expect(connect).toEqual(expect.objectContaining({ lookup: expect.any(Function) }))
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    const callback = vi.fn()
    if (typeof connect === 'object' && 'lookup' in connect && typeof connect.lookup === 'function') {
      connect.lookup('public.example', {}, callback)
    }
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4)
    expect(lookup).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith('https://public.example/backend/api/v1/oauth/validate',
      expect.objectContaining({ redirect: 'error', dispatcher: expect.anything() }))
  })

  it('preserves only the exact operator-configured private backend exception', async () => {
    vi.stubEnv('ASTRID_API_BASE_URL', 'http://127.0.0.1:9999/backend')
    await validateMCPAuthContext({ accessToken: 'fixture-not-real' }, brandOrigin())
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9999/backend/api/v1/oauth/validate',
      expect.objectContaining({ redirect: 'error' }))
    await expect(validateMCPAuthContext({
      accessToken: 'fixture-not-real', baseUrl: 'http://127.0.0.1:9999/other',
    }, brandOrigin())).rejects.toThrow()
  })

  it.each([false, true])('protects API requests and client token exchange (Basic=%s)', async basic => {
    const client = new OAuthAPIClient('https://127.0.0.1', 'fixture-client',
      'fixture-secret', basic ? null : 'fixture-not-real', true)
    await expect(client.makeRequest('/api/v1/lists')).rejects.toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves backend prefixes and API query parameters without permitting authority escapes', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"lists":[]}', {
      headers: { 'Content-Type': 'application/json' },
    }))
    const client = new OAuthAPIClient('https://public.example/backend', undefined,
      undefined, 'fixture-not-real', true)
    await expect(client.makeRequest('/api/v1/lists?limit=10')).resolves.toEqual({ lists: [] })
    expect(fetch).toHaveBeenCalledWith('https://public.example/backend/api/v1/lists?limit=10',
      expect.objectContaining({ redirect: 'error' }))
    await expect(fetchMCPBackend('https://public.example/backend', '/../private')).rejects.toThrow()
    await expect(fetchMCPBackend('https://public.example/backend', '//private.example')).rejects.toThrow()
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('keeps local stdio requests on their existing operator-configured transport', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{"lists":[]}'))
    const client = new OAuthAPIClient('http://127.0.0.1:9999', undefined,
      undefined, 'fixture-not-real')
    await expect(client.makeRequest('/api/v1/lists')).resolves.toEqual({ lists: [] })
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9999/api/v1/lists', expect.anything())
  })

  it('cancels oversized backend bodies before closing the pinned connection', async () => {
    const cancel = vi.fn()
    vi.mocked(fetch).mockResolvedValue(new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(16 * 1024 * 1024 + 1))
      },
      cancel,
    })))
    await expect(fetchMCPBackend('https://public.example', '/api/v1/lists'))
      .rejects.toThrow('exceeds 16 MiB')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each([301, 302, 303, 307, 308])('refuses HTTP %s redirects on every hosted fetch', async status => {
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      expect(init?.redirect).toBe('error')
      throw new TypeError(`fixture redirect ${status} rejected`)
    })
    await expect(validateMCPAuthContext({
      accessToken: 'fixture-not-real', baseUrl: 'https://public.example',
    }, brandOrigin())).rejects.toThrow()
    for (const token of ['fixture-not-real', null]) {
      const client = new OAuthAPIClient('https://public.example', 'fixture-client',
        'fixture-secret', token, true)
      await expect(client.makeRequest('/api/v1/lists')).rejects.toThrow()
    }
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
