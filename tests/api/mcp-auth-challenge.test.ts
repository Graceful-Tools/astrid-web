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
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'stream'
import handler from '@/pages/api/mcp/index'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

function res() {
  const headers: Record<string, string> = {}
  let statusCode = 200
  return {
    headers,
    get statusCode() { return statusCode },
    status(code: number) { statusCode = code; return this },
    json() { return this },
    end() { return this },
    setHeader(k: string, v: string) { headers[k] = v },
    get headersSent() { return false },
  }
}

beforeEach(() => vi.clearAllMocks())

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
})
