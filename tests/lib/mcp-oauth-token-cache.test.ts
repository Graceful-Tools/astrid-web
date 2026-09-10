/**
 * Task 11f578e0 — the hosted Streamable HTTP endpoint (pages/api/mcp/index.ts)
 * constructs a new AstridMCPServerOAuth per POST, so the OAuthAPIClient's
 * per-instance token cache never hit for Basic-auth sessions: every JSON-RPC
 * request minted a fresh token via client_credentials, multiplying
 * token-endpoint load and risking the OAuth token rate limiter.
 *
 * The fix is a process-level cache keyed by SHA-256 of the credentials.
 * These tests drive OAuthAPIClient — the class each per-request server
 * builds — directly: two instances sharing credentials must mint one token.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function mockTokenEndpoint(expiresIn = 3600) {
  const fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: `tok-${Math.random()}`, expires_in: expiresIn }),
      } as Response
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ lists: [] }),
    } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const tokenCalls = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('/oauth/token'))

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MCP OAuth process-level token cache (task 11f578e0)', () => {
  it('mints one token for two client instances sharing credentials', async () => {
    const fetchMock = mockTokenEndpoint()
    const { OAuthAPIClient } = await import('@/mcp/mcp-server-oauth')

    const first = new OAuthAPIClient('https://example.com', 'client-a', 'secret-a')
    const second = new OAuthAPIClient('https://example.com', 'client-a', 'secret-a')

    await first.makeRequest('/api/v1/lists')
    await second.makeRequest('/api/v1/lists')

    expect(tokenCalls(fetchMock)).toHaveLength(1)
  })

  it('keeps different credentials on separate cache entries', async () => {
    const fetchMock = mockTokenEndpoint()
    const { OAuthAPIClient } = await import('@/mcp/mcp-server-oauth')

    await new OAuthAPIClient('https://example.com', 'client-a', 'secret-a').makeRequest(
      '/api/v1/lists'
    )
    await new OAuthAPIClient('https://example.com', 'client-a', 'secret-b').makeRequest(
      '/api/v1/lists'
    )

    expect(tokenCalls(fetchMock)).toHaveLength(2)
  })

  it('coalesces concurrent token fetches for the same credentials', async () => {
    const fetchMock = mockTokenEndpoint()
    const { OAuthAPIClient } = await import('@/mcp/mcp-server-oauth')

    const first = new OAuthAPIClient('https://example.com', 'client-a', 'secret-a')
    const second = new OAuthAPIClient('https://example.com', 'client-a', 'secret-a')

    await Promise.all([first.makeRequest('/api/v1/lists'), second.makeRequest('/api/v1/lists')])

    expect(tokenCalls(fetchMock)).toHaveLength(1)
  })

  it('re-fetches once the cached token passes the expiry margin', async () => {
    // expires_in under the 5-minute safety margin: already stale on arrival.
    const fetchMock = mockTokenEndpoint(200)
    const { OAuthAPIClient } = await import('@/mcp/mcp-server-oauth')

    const client = new OAuthAPIClient('https://example.com', 'client-a', 'secret-a')
    await client.makeRequest('/api/v1/lists')
    await client.makeRequest('/api/v1/lists')

    expect(tokenCalls(fetchMock)).toHaveLength(2)
  })

  it('never hits the token endpoint for static access-token sessions', async () => {
    const fetchMock = mockTokenEndpoint()
    const { OAuthAPIClient } = await import('@/mcp/mcp-server-oauth')

    const client = new OAuthAPIClient('https://example.com', undefined, undefined, 'static-token')
    await client.makeRequest('/api/v1/lists')

    expect(tokenCalls(fetchMock)).toHaveLength(0)
    const apiCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/v1/lists'))
    expect((apiCall![1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer static-token',
    })
  })
})
