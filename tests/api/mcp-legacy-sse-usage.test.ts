/**
 * @vitest-environment node
 *
 * AWTD-1461 — the legacy MCP SSE session map is per-instance, so a POST to
 * /mcp/messages that lands on another instance cannot find its session.
 *
 * Dropping the transport is the recommended fix, but it is only safe once we
 * can show no client still uses it — and Vercel's log window is minutes long.
 * These pin the interim: every legacy touch is counted in the durable census,
 * and a session miss gets an explanatory 404 instead of a bare "not found".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'stream'
import messagesHandler from '@/pages/api/mcp/messages'
import handler from '@/pages/api/mcp/index'
import { buildAuthSignature } from '@/lib/server/mcp-http-utils'
import { mcpClientLabel, mcpLegacyPlatform } from '@/lib/server/mcp-legacy-sse-usage'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn().mockResolvedValue({ source: 'oauth' }),
  UnauthorizedError: class extends Error {},
}))
const recordLegacyApiHit = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock('@/lib/legacy-api-usage-service', () => ({ recordLegacyApiHit }))
const getSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/server/mcp-session-store', () => ({
  getSession,
  storeSession: vi.fn(),
  deleteSession: vi.fn(),
}))
vi.mock('@modelcontextprotocol/sdk/server/sse.js', () => ({
  SSEServerTransport: class { sessionId = 'fixture-session' },
}))
vi.mock('@/mcp/mcp-server-oauth', () => ({
  // Streamable HTTP: answer the request so the handler can return; SSE: no-op.
  default: class {
    async startWithTransport(t: any) {
      if (!('sessionId' in t)) t.onmessage = (m: any) => t.send({ jsonrpc: '2.0', id: m.id, result: {} })
    }
  },
}))

function res() {
  let statusCode = 200
  let payload: any
  return {
    get payload() { return payload },
    get statusCode() { return statusCode },
    status(code: number) { statusCode = code; return this },
    json(data: unknown) { payload = data; return this },
    end() { return this },
    setHeader() {},
    get headersSent() { return false },
  }
}

function request(method: string, headers: Record<string, string> = {}, query: Record<string, string> = {}) {
  return Object.assign(Readable.from([Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')]), {
    method,
    headers: { 'content-type': 'application/json', authorization: 'Bearer astrid_fixture', ...headers },
    query,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '' }))
})

describe('legacy MCP SSE census (AWTD-1461)', () => {
  it('AWTD-1461 answers a session miss with an explanatory 404 and counts it', async () => {
    getSession.mockReturnValue(undefined)
    const r = res()
    await messagesHandler(request('POST', { 'user-agent': 'node' }, { sessionId: 'gone' }) as never, r as never)

    expect(r.statusCode).toBe(404)
    expect(r.payload.error).toMatch(/this server instance/)
    expect(r.payload.error).toMatch(/Streamable HTTP/)
    expect(recordLegacyApiHit).toHaveBeenCalledWith({
      route: '/mcp/messages#session-miss', method: 'POST', platform: 'mcp:node',
    })
  })

  it('AWTD-1461 counts a delivered /mcp/messages POST as the unambiguous legacy signal', async () => {
    const handlePostMessage = vi.fn(async (_req, r) => r.status(202).end())
    const req = request('POST', { 'user-agent': 'openai-mcp/1.0' }, { sessionId: 'fixture-session' })
    getSession.mockReturnValue({
      authSignature: buildAuthSignature(req as never),
      authOptions: { accessToken: 'astrid_fixture' },
      transport: { handlePostMessage },
    })
    const r = res()
    await messagesHandler(req as never, r as never)

    expect(r.payload).toBeUndefined()
    expect(handlePostMessage).toHaveBeenCalled()
    expect(recordLegacyApiHit).toHaveBeenCalledWith({
      route: '/mcp/messages', method: 'POST', platform: 'mcp:openai-mcp',
    })
  })

  it('AWTD-1461 counts an SSE stream and tells Streamable-HTTP listen GETs apart', async () => {
    await handler(request('GET', { 'user-agent': 'claude-code/2.0 (cli)', 'mcp-protocol-version': '2025-06-18' }) as never, res() as never)
    await handler(request('GET', { 'user-agent': 'node' }) as never, res() as never)

    expect(recordLegacyApiHit).toHaveBeenCalledWith({ route: '/mcp', method: 'GET', platform: 'mcp:claude-code/streamable' })
    expect(recordLegacyApiHit).toHaveBeenCalledWith({ route: '/mcp', method: 'GET', platform: 'mcp:node' })
  })

  it('AWTD-1461 does not count Streamable HTTP POSTs to /mcp', async () => {
    await handler(request('POST', { 'user-agent': 'claude-code/2.0' }) as never, res() as never)
    expect(recordLegacyApiHit).not.toHaveBeenCalled()
  })

  it('AWTD-1461 keeps only a bounded product token from the user-agent', () => {
    expect(mcpClientLabel('Mozilla/5.0 (Macintosh)')).toBe('mozilla')
    expect(mcpClientLabel('')).toBe('unknown')
    expect(mcpClientLabel(undefined)).toBe('unknown')
    expect(mcpClientLabel('x'.repeat(100))).toHaveLength(32)
    expect(mcpLegacyPlatform({ headers: {} })).toBe('mcp:unknown')
  })
})
