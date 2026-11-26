/**
 * @vitest-environment node
 *
 * AWTD-1569 — the legacy MCP SSE transport (a GET stream plus POST
 * /mcp/messages, with sessions in a per-instance Map) is retired. `/mcp` now
 * speaks Streamable HTTP only, and this pins the contract every current client
 * (Claude Code, Copilot, VS Code, the OpenAI connectors) relies on: one URL,
 * one JSON-RPC message per POST, the reply in the response body.
 *
 *   initialize → tools/list → tools/call
 *
 * plus the optional listen GET, which still opens a silent event stream.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import handler from '@/pages/api/mcp/index'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('undici', async importOriginal => ({
  ...await importOriginal<typeof import('undici')>(),
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
}))
vi.mock('@/lib/api-auth-middleware', () => ({
  authenticateAPI: vi.fn().mockResolvedValue({
    userId: 'fixture-user', source: 'oauth', scopes: ['tasks:read', 'lists:read'],
    isAIAgent: false,
    user: { id: 'fixture-user', email: 'fixture@example.test', name: null, isAIAgent: false },
  }),
  UnauthorizedError: class extends Error {},
}))

const FIXTURE_LISTS = [{ id: 'fixture-list', name: 'Fixture list' }]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/api/v1/lists')) {
      return new Response(JSON.stringify({ lists: FIXTURE_LISTS }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('{}', { status: 404 })
  }))
})
afterEach(() => { vi.unstubAllGlobals() })

async function post(body: unknown) {
  const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer astrid_fixture_token' },
    query: {},
  })
  let statusCode = 200
  let payload: any = null
  const res = {
    status(code: number) { statusCode = code; return this },
    json(data: unknown) { payload = data; return this },
    end() { return this },
    setHeader() {},
    get headersSent() { return false },
  }
  await handler(req as never, res as never)
  return { statusCode, payload }
}

describe('AWTD-1569 /mcp answers Streamable HTTP', () => {
  it('AWTD-1569 initialize returns server info and a protocol version', async () => {
    const { statusCode, payload } = await post({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'contract', version: '1' } },
    })

    expect(statusCode).toBe(200)
    expect(payload).toMatchObject({ jsonrpc: '2.0', id: 1 })
    expect(payload.result.serverInfo.name).toBeTruthy()
    expect(payload.result.protocolVersion).toBeTruthy()
    expect(payload.result.capabilities.tools).toBeDefined()
  })

  it('AWTD-1569 tools/list returns the tool catalogue', async () => {
    const { statusCode, payload } = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })

    expect(statusCode).toBe(200)
    expect(payload.id).toBe(2)
    const names = payload.result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(expect.arrayContaining(['get_lists', 'get_task', 'get_agent_queue']))
  })

  it('AWTD-1569 tools/call runs the tool and returns its content in the POST response', async () => {
    const { statusCode, payload } = await post({
      jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_lists', arguments: {} },
    })

    expect(statusCode).toBe(200)
    expect(payload.id).toBe(3)
    expect(payload.result.isError).toBeFalsy()
    const text = JSON.parse(payload.result.content[0].text)
    expect(text.lists).toEqual(FIXTURE_LISTS)
  })

  it('AWTD-1569 an authenticated GET opens a silent listen stream and ends when the client leaves', async () => {
    const req = Object.assign(Readable.from([]), {
      method: 'GET',
      headers: { authorization: 'Bearer astrid_fixture_token', 'mcp-protocol-version': '2025-03-26' },
      query: {},
    })
    const res = Object.assign(new EventEmitter(), {
      statusCode: 0,
      headers: {} as Record<string, string>,
      written: '',
      destroyed: false,
      writableEnded: false,
      writeHead(code: number, headers: Record<string, string>) { this.statusCode = code; this.headers = headers; return this },
      write(chunk: string) { this.written += chunk; return true },
      end() { this.writableEnded = true; return this },
      status() { throw new Error('GET must not answer with a JSON status') },
      json() { throw new Error('GET must not answer with JSON') },
      setHeader() {},
      get headersSent() { return this.statusCode !== 0 },
    })

    const done = handler(req as never, res as never)
    await vi.waitFor(() => expect(res.statusCode).toBe(200))
    expect(res.headers['Content-Type']).toBe('text/event-stream')
    // No legacy `endpoint` event pointing at /mcp/messages, and no messages:
    // only SSE comment lines, which every client parser skips.
    expect(res.written).not.toContain('endpoint')
    expect(res.written.split('\n').filter(Boolean).every(line => line.startsWith(':'))).toBe(true)
    expect(res.writableEnded).toBe(false)

    res.emit('close')
    await done
    expect(res.writableEnded).toBe(true)
  })

  it('AWTD-1569 the legacy SSE message endpoint and session store are gone', () => {
    const root = process.cwd()
    expect(existsSync(join(root, 'pages/api/mcp/messages.ts'))).toBe(false)
    expect(existsSync(join(root, 'lib/server/mcp-session-store.ts'))).toBe(false)
  })
})
