/**
 * @vitest-environment node
 *
 * MCP clients (VS Code / GitHub Copilot, Claude Desktop) discover how to
 * authenticate from the 401 itself: per the MCP authorization spec the server
 * answers with
 *
 *   WWW-Authenticate: Bearer resource_metadata="<...>/.well-known/oauth-protected-resource/mcp"
 *
 * and the client follows that to the OAuth server and runs the flow for you.
 *
 * Astrid published the resource metadata document but never sent the header, so
 * a client hitting /mcp got a bare 401 with nowhere to go — turning a one-click
 * connect into hand-configured credentials.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Readable } from 'stream'
import handler from '@/pages/api/mcp/index'
import messagesHandler from '@/pages/api/mcp/messages'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'
import { BRAND } from '@/lib/brand/config'
import { buildAuthSignature } from '@/lib/server/mcp-http-utils'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn(),
  UnauthorizedError: class extends Error {},
}))
const getSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/mcp-session-store', () => ({
  getSession,
  storeSession: vi.fn(),
  deleteSession: vi.fn(),
}))

function res() {
  const headers: Record<string, string> = {}
  let statusCode = 200
  let payload: unknown
  return {
    headers,
    get payload() { return payload },
    get statusCode() { return statusCode },
    status(code: number) { statusCode = code; return this },
    json(data: unknown) { payload = data; return this },
    end() { return this },
    setHeader(k: string, v: string) { headers[k] = v },
    get headersSent() { return false },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAPI).mockResolvedValue({
    userId: 'fixture-user', source: 'oauth', scopes: ['tasks:read'],
    isAIAgent: false,
    user: { id: 'fixture-user', email: 'fixture@example.test', name: null, isAIAgent: false },
  })
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => vi.unstubAllGlobals())

function request(method: string, authorization?: string, rpcMethod = 'tools/list') {
  return Object.assign(Readable.from([Buffer.from(JSON.stringify({
    jsonrpc: '2.0', id: 1, method: rpcMethod, params: {},
  }))]), {
    method,
    headers: { host: `www.${BRAND.domain}`, 'content-type': 'application/json', authorization },
    query: {},
  })
}

describe('/mcp unauthenticated challenge', () => {
  it('tells a POST client where to discover OAuth', async () => {
    const req = Object.assign(Readable.from([Buffer.from('{}')]), {
      method: 'POST', headers: { 'content-type': 'application/json' }, query: {},
    })
    const r = res()

    await handler(req as never, r as never)

    expect(r.statusCode).toBe(401)
    const challenge = r.headers['WWW-Authenticate']
    expect(challenge, 'a bare 401 leaves the client nowhere to go').toBeTruthy()
    expect(challenge).toContain('Bearer')
    expect(challenge).toContain('resource_metadata=')
    expect(challenge).toContain('/.well-known/oauth-protected-resource/mcp')
  })

  it('tells an SSE (GET) client the same thing', async () => {
    const req = Object.assign(Readable.from([]), { method: 'GET', headers: {}, query: {} })
    const r = res()

    await handler(req as never, r as never)

    expect(r.statusCode).toBe(401)
    expect(r.headers['WWW-Authenticate']).toContain('resource_metadata=')
  })

  it('does not challenge a request that carried credentials', async () => {
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
    }))]), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
      query: {},
    })
    const r = res()

    await handler(req as never, r as never)

    expect(r.statusCode).not.toBe(401)
  })

  it.each(['POST', 'GET'])('AITD-447 challenges a rejected bearer on %s before dispatch', async method => {
    vi.mocked(authenticateAPI).mockRejectedValue(new UnauthorizedError('No valid authentication found'))
    const r = res()
    await handler(request(method, 'Bearer astrid_fixture_invalid') as never, r as never)

    expect(r.statusCode).toBe(401)
    expect(r.headers['WWW-Authenticate']).toContain('error="invalid_token"')
    expect(r.headers['WWW-Authenticate']).toContain(
      `resource_metadata="https://www.${BRAND.domain}/.well-known/oauth-protected-resource/mcp"`,
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('AITD-447 rejects invalid credentials on initialize, not just tool calls', async () => {
    vi.mocked(authenticateAPI).mockRejectedValue(new UnauthorizedError())
    const r = res()
    await handler(request('POST', 'Bearer astrid_fixture_invalid', 'initialize') as never, r as never)

    expect(r.statusCode).toBe(401)
    expect(r.headers['WWW-Authenticate']).toContain('error="invalid_token"')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('AITD-447 does not disguise a backend validation failure as an invalid token', async () => {
    vi.mocked(authenticateAPI).mockRejectedValue(new Error('fixture backend unavailable'))
    const r = res()
    await handler(request('POST', 'Bearer astrid_fixture_valid') as never, r as never)

    expect(r.statusCode).toBe(500)
    expect(r.headers['WWW-Authenticate']).toBeUndefined()
    expect(JSON.stringify(r.payload)).not.toContain('fixture backend unavailable')
  })

  it('AITD-447 validates a bearer without forwarding browser cookies', async () => {
    const req = request('POST', 'Bearer astrid_fixture_valid')
    Object.assign(req.headers, { cookie: 'fixture-cookie' })
    const r = res()
    await handler(req as never, r as never)

    const authRequest = vi.mocked(authenticateAPI).mock.calls[0]?.[0]
    expect(authRequest?.headers.get('authorization')).toBe('Bearer astrid_fixture_valid')
    expect(authRequest?.headers.get('cookie')).toBeNull()
    expect(vi.mocked(authenticateAPI).mock.calls[0]?.[2]).toEqual({ tokenOnly: true })
    expect(r.statusCode).toBe(200)
  })

  it.each(['Basic Zml4dHVyZTpwYXNzd29yZA==', 'Bearer astrid_mcp_fixture_valid'])(
    'AITD-447 preserves the supported credential method %s', async authorization => {
      const r = res()
      await handler(request('POST', authorization) as never, r as never)

      expect(r.statusCode).toBe(200)
      expect(r.headers['WWW-Authenticate']).toBeUndefined()
      if (authorization.startsWith('Basic ')) expect(authenticateAPI).not.toHaveBeenCalled()
      else expect(authenticateAPI).toHaveBeenCalled()
    },
  )

  it('AITD-447 revalidates a bearer on the legacy SSE message endpoint', async () => {
    const handlePostMessage = vi.fn()
    const req = request('POST', 'Bearer astrid_fixture_expired')
    getSession.mockReturnValue({
      authSignature: buildAuthSignature(req as never),
      authOptions: { accessToken: 'astrid_fixture_expired' },
      transport: { handlePostMessage },
    })
    vi.mocked(authenticateAPI).mockRejectedValue(new UnauthorizedError())
    Object.assign(req.query, { sessionId: 'fixture-session' })
    const r = res()
    await messagesHandler(req as never, r as never)

    expect(r.statusCode).toBe(401)
    expect(r.headers['WWW-Authenticate']).toContain('error="invalid_token"')
    expect(r.headers['WWW-Authenticate']).toContain('resource_metadata=')
    expect(handlePostMessage).not.toHaveBeenCalled()
    expect(authenticateAPI).toHaveBeenCalled()
  })

  it('AITD-447 rejects a POST selecting a different bearer than its retained SSE server', async () => {
    const handlePostMessage = vi.fn()
    const req = request('POST', 'Bearer astrid_fixture_A')
    getSession.mockReturnValue({
      authSignature: buildAuthSignature(req as never),
      authOptions: { accessToken: 'astrid_fixture_A' },
      transport: { handlePostMessage },
    })
    Object.assign(req.headers, { 'x-astrid-access-token': 'astrid_fixture_B' })
    Object.assign(req.query, { sessionId: 'fixture-session' })
    const r = res()
    await messagesHandler(req as never, r as never)
    expect(r.statusCode).toBe(401)
    expect(handlePostMessage).not.toHaveBeenCalled()
  })

  it('AITD-447 leaves an authenticated authorization failure as a tool error', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      error: 'Forbidden', message: 'Missing required scopes: tasks:read',
    }), { status: 403 }))
    const req = request('POST', 'Bearer astrid_fixture_valid')
    const body = {
      jsonrpc: '2.0', id: 1, method: 'tools/call',
      params: { name: 'get_task', arguments: { taskId: 'fixture-task' } },
    }
    const toolReq = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
      method: req.method, headers: req.headers, query: {},
    })
    const r = res()
    await handler(toolReq as never, r as never)

    expect(r.statusCode).toBe(200)
    expect(r.headers['WWW-Authenticate']).toBeUndefined()
    expect(r.payload).toMatchObject({ result: { isError: true } })
  })
})
