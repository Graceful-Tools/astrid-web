/**
 * @vitest-environment node
 *
 * Regression for task a0e0808c — "API connection is difficult to set up as an
 * MCP server".
 *
 * /mcp only ever spoke the SSE transport: GET opens a long-lived stream and the
 * client must POST JSON-RPC to a *different* URL, /mcp/messages. POST /mcp
 * returned 405. Current MCP clients (Copilot, Claude) speak Streamable HTTP,
 * which POSTs to the single /mcp URL and reads the reply from the response
 * body — so connecting Astrid meant discovering the split-URL SSE setup, which
 * is precisely the difficulty this task reports.
 *
 * These pin the Streamable HTTP handshake on the one URL, without disturbing
 * the SSE path that existing clients may still use.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Readable } from 'stream'
import handler from '@/pages/api/mcp/index'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

beforeEach(() => {
  // initialize/tools/list need no upstream call; stub fetch so nothing escapes.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true, status: 200, json: async () => ({}), text: async () => '',
  }))
})

/** Drive the Pages Router handler with a POST body and capture the response. */
async function rpc(body: unknown, { auth = 'Bearer test-token' }: { auth?: string | null } = {}) {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const req = Object.assign(Readable.from([Buffer.from(raw)]), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
    query: {},
  })

  let statusCode = 200
  let payload: any = null
  let ended = false
  const headers: Record<string, string> = {}
  const res = {
    status(code: number) { statusCode = code; return this },
    json(data: unknown) { payload = data; ended = true; return this },
    end() { ended = true; return this },
    setHeader(k: string, v: string) { headers[k] = v },
    get headersSent() { return false },
  }

  // A handler that never answers is the bug being pinned below, so a hang has
  // to fail the test rather than stall the whole run.
  const hung = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('handler never responded (request hung)')), 3000)
  )
  await Promise.race([handler(req as never, res as never), hung])
  return { statusCode, payload, headers, ended }
}

describe('/mcp Streamable HTTP endpoint (task a0e0808c)', () => {
  it('answers an initialize handshake on the same URL', async () => {
    const { statusCode, payload } = await rpc({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'probe', version: '1' } },
    })

    expect(statusCode).toBe(200)
    expect(payload.jsonrpc).toBe('2.0')
    expect(payload.id).toBe(1)
    // Every MCP client does this first; without it nothing else runs.
    expect(payload.result?.serverInfo?.name).toBeTruthy()
    expect(payload.result?.protocolVersion).toBeTruthy()
  })

  it('acknowledges a notification with 202 instead of hanging (Claude Code connect timeout)', async () => {
    // Streamable HTTP clients send `notifications/initialized` right after the
    // initialize reply. A notification has no id and gets no JSON-RPC response,
    // so the transport waiting for one never settled: the POST stayed open until
    // the client gave up — Claude Code reported CONNECT_TIMEOUT after 30s, with
    // initialize and tools/list both answering in under 200ms.
    const { statusCode, ended, payload } = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })

    expect(statusCode).toBe(202)
    expect(ended).toBe(true)
    expect(payload).toBeNull()
  })

  it('lists tools so a client can discover what Astrid exposes', async () => {
    const { statusCode, payload } = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })

    expect(statusCode).toBe(200)
    const names = (payload.result?.tools ?? []).map((t: { name: string }) => t.name)
    expect(names.length).toBeGreaterThan(0)
    expect(names).toContain('get_lists')
  })

  it('returns a JSON-RPC error for an unknown method rather than throwing', async () => {
    const { statusCode, payload } = await rpc({ jsonrpc: '2.0', id: 3, method: 'no/such/method', params: {} })

    expect(statusCode).toBe(200)
    expect(payload.error).toBeTruthy()
    expect(payload.id).toBe(3)
  })

  it('rejects a malformed body with a parse error, not a crash', async () => {
    const { statusCode, payload } = await rpc('not json')

    expect(statusCode).toBe(400)
    expect(payload.error?.code).toBe(-32700)
  })

  it('requires credentials', async () => {
    const { statusCode } = await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, { auth: null })

    expect(statusCode).toBe(401)
  })

  it('advertises POST alongside the SSE GET', async () => {
    const req = Object.assign(Readable.from([]), { method: 'OPTIONS', headers: {}, query: {} })
    const headers: Record<string, string> = {}
    const res = {
      status() { return this },
      json() { return this },
      end() { return this },
      setHeader(k: string, v: string) { headers[k] = v },
      get headersSent() { return false },
    }

    await handler(req as never, res as never)

    // SSE clients still need GET; Streamable HTTP clients need POST.
    expect(headers.Allow).toContain('POST')
    expect(headers.Allow).toContain('GET')
  })
})
