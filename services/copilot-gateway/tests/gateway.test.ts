/**
 * ADEV-244: the Copilot gateway's HTTP contract, with the SDK client faked.
 */
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Redactor, createLog } from '../src/log.js'
import { MemorySessionFs } from '../src/memory-session-fs.js'
import { bearerMatches, createGatewayServer } from '../src/server.js'
import {
  TurnManager,
  type CopilotClientLike,
  type SessionEventLike,
  type SessionLike,
  type TurnSessionSpec,
} from '../src/turns.js'

const SECRET = 'test-gateway-secret-0123456789abcdef'
const TOKEN = 'gho_secret_user_token_never_logged_42'

type Script = (session: FakeSession) => void

/** A session that plays a scripted conversation in response to send / tool results. */
class FakeSession implements SessionLike {
  readonly sessionId: string
  handlers: Array<(e: SessionEventLike) => void> = []
  aborted = false
  disconnected = false
  toolResults: Array<{ requestId: string; result?: string }> = []
  constructor(
    id: string,
    private readonly onSend: Script,
    private readonly onToolResult: (session: FakeSession, requestId: string, result?: string) => void
  ) {
    this.sessionId = id
  }
  on(handler: (e: SessionEventLike) => void) {
    this.handlers.push(handler)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler)
    }
  }
  emit(type: string, data: unknown = {}) {
    for (const h of [...this.handlers]) h({ type, data })
  }
  async send() {
    queueMicrotask(() => this.onSend(this))
    return 'msg-1'
  }
  async abort() {
    this.aborted = true
  }
  async disconnect() {
    this.disconnected = true
  }
  rpc = {
    tools: {
      handlePendingToolCall: async (p: { requestId: string; result?: string }) => {
        this.toolResults.push(p)
        queueMicrotask(() => this.onToolResult(this, p.requestId, p.result))
        return { success: true }
      },
    },
  }
}

class FakeClient implements CopilotClientLike {
  specs: TurnSessionSpec[] = []
  sessions: FakeSession[] = []
  deleted: string[] = []
  tokensSeen: string[] = []
  constructor(
    private readonly onSend: Script,
    private readonly onToolResult: (s: FakeSession, id: string, result?: string) => void = () => {}
  ) {}
  async createSession(spec: TurnSessionSpec) {
    this.specs.push(spec)
    this.tokensSeen.push(spec.githubToken())
    const s = new FakeSession(`session-${this.sessions.length + 1}`, this.onSend, this.onToolResult)
    this.sessions.push(s)
    return s
  }
  async deleteSession(id: string) {
    this.deleted.push(id)
  }
}

const answer =
  (text: string): Script =>
  (s) => {
    s.emit('assistant.message', { content: text, messageId: 'm' })
    s.emit('assistant.usage', { model: 'gpt-5', inputTokens: 10, outputTokens: 5 })
    s.emit('session.idle', {})
  }

describe('copilot-gateway (ADEV-244)', () => {
  let server: Server
  let base: string
  let logLines: string[]
  let client: FakeClient
  let turns: TurnManager

  async function boot(c: FakeClient, opts: { idleMs?: number } = {}) {
    client = c
    logLines = []
    const redactor = new Redactor()
    redactor.add(SECRET)
    const log = createLog(redactor, (line) => logLines.push(line))
    turns = new TurnManager({ client, log, redactor, idleMs: opts.idleMs, settleMs: 5, stepTimeoutMs: 2_000 })
    server = createGatewayServer({
      secret: SECRET,
      turns,
      log,
      health: () => ({ ok: true, sdkVersion: '2.0.1', runtimeVersion: '1.0.114' }),
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }

  afterEach(async () => {
    await turns?.closeAll()
    await new Promise<void>((r) => server?.close(() => r()))
  })

  const post = (path: string, body: unknown, auth: string | null = `Bearer ${SECRET}`) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
      body: JSON.stringify(body),
    })

  const turnBody = (extra: Record<string, unknown> = {}) => ({
    githubToken: TOKEN,
    model: 'gpt-5',
    prompt: 'Say hi',
    ...extra,
  })

  describe('auth', () => {
    beforeEach(() => boot(new FakeClient(answer('hi'))))

    it('ADEV-244: a missing bearer secret is 401 and creates no session', async () => {
      const res = await post('/v1/turns', turnBody(), null)
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Unauthorized' })
      expect(client.sessions).toHaveLength(0)
    })

    it('ADEV-244: a wrong bearer secret is 401', async () => {
      expect((await post('/v1/turns', turnBody(), 'Bearer nope')).status).toBe(401)
      expect((await post('/v1/turns', turnBody(), SECRET)).status).toBe(401)
      expect((await post('/v1/turns/abc/tool-results', { results: [{ id: 'x', output: 'y' }] }, 'Bearer nope')).status).toBe(
        401
      )
      expect(client.sessions).toHaveLength(0)
    })

    it('ADEV-244: bearerMatches compares in constant time and handles any length', () => {
      expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true)
      expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false)
      expect(bearerMatches('Bearer ', SECRET)).toBe(false)
      expect(bearerMatches(undefined, SECRET)).toBe(false)
    })

    it('ADEV-244: GET /healthz answers without a token', async () => {
      const res = await fetch(`${base}/healthz`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true, sdkVersion: '2.0.1', runtimeVersion: '1.0.114' })
    })
  })

  it('ADEV-244: a done turn returns text and usage, and deletes its session', async () => {
    await boot(new FakeClient(answer('Hello from Copilot')))

    const res = await post('/v1/turns', turnBody({ maxTokens: 512, jsonOnly: true }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      status: 'done',
      text: 'Hello from Copilot',
      usage: { inputTokens: 10, outputTokens: 5 },
    })
    expect(client.tokensSeen).toEqual([TOKEN])
    expect(client.specs[0]).toMatchObject({ model: 'gpt-5', maxTokens: 512, jsonOnly: true, tools: [] })
    expect(client.sessions[0].disconnected).toBe(true)
    expect(client.deleted).toEqual(['session-1'])
    expect(turns.activeTurns).toBe(0)
  })

  it('ADEV-244: a tool-call round trip hands back declared calls and resumes with the results', async () => {
    const c = new FakeClient(
      (s) => {
        s.emit('assistant.usage', { inputTokens: 7, outputTokens: 3 })
        s.emit('external_tool.requested', {
          requestId: 'req-1',
          toolCallId: 'tc-1',
          toolName: 'get_repository_file',
          arguments: { path: 'README.md' },
        })
        s.emit('external_tool.requested', {
          requestId: 'req-2',
          toolCallId: 'tc-2',
          toolName: 'list_repository_files',
          arguments: {},
        })
      },
      (s) => {
        if (s.toolResults.length === 2) {
          s.emit('assistant.message', { content: 'The readme says hi' })
          s.emit('assistant.usage', { inputTokens: 20, outputTokens: 8 })
          s.emit('session.idle', {})
        }
      }
    )
    await boot(c)
    const tools = [
      { name: 'get_repository_file', description: 'Read a file', parameters: { type: 'object', properties: {} } },
      { name: 'list_repository_files', description: 'List files', parameters: { type: 'object', properties: {} } },
    ]

    const first = await post('/v1/turns', turnBody({ tools }))
    expect(first.status).toBe(200)
    const pending = await first.json()
    expect(pending).toMatchObject({
      status: 'tool_calls',
      calls: [
        { id: 'req-1', name: 'get_repository_file', arguments: { path: 'README.md' } },
        { id: 'req-2', name: 'list_repository_files', arguments: {} },
      ],
    })
    expect(typeof pending.turnId).toBe('string')
    expect(client.specs[0].tools.map((t) => t.name)).toEqual(['get_repository_file', 'list_repository_files'])
    expect(client.deleted).toEqual([])

    const second = await post(`/v1/turns/${pending.turnId}/tool-results`, {
      results: [
        { id: 'req-1', output: '# Readme\nhi' },
        { id: 'req-2', output: '["README.md"]' },
      ],
    })
    expect(second.status).toBe(200)
    expect(await second.json()).toEqual({
      status: 'done',
      text: 'The readme says hi',
      usage: { inputTokens: 27, outputTokens: 11 },
    })
    expect(client.sessions[0].toolResults).toEqual([
      { requestId: 'req-1', result: '# Readme\nhi' },
      { requestId: 'req-2', result: '["README.md"]' },
    ])
    expect(client.deleted).toEqual(['session-1'])

    // The turn is gone once done.
    expect((await post(`/v1/turns/${pending.turnId}/tool-results`, { results: [{ id: 'req-1', output: 'x' }] })).status).toBe(
      404
    )
  })

  it('ADEV-244: a result for a call the turn is not waiting on is 400', async () => {
    await boot(
      new FakeClient((s) =>
        s.emit('external_tool.requested', { requestId: 'req-1', toolName: 'get_repository_file', arguments: {} })
      )
    )
    const pending = await (await post('/v1/turns', turnBody())).json()
    const res = await post(`/v1/turns/${pending.turnId}/tool-results`, { results: [{ id: 'other', output: 'x' }] })
    expect(res.status).toBe(400)
  })

  it('ADEV-244: an idle turn expires, its session is deleted, and later results get 404', async () => {
    await boot(
      new FakeClient((s) =>
        s.emit('external_tool.requested', { requestId: 'req-1', toolName: 'get_repository_file', arguments: {} })
      ),
      { idleMs: 30 }
    )
    const pending = await (await post('/v1/turns', turnBody())).json()
    expect(pending.status).toBe('tool_calls')

    await new Promise((r) => setTimeout(r, 80))

    expect(client.sessions[0].aborted).toBe(true)
    expect(client.deleted).toEqual(['session-1'])
    const res = await post(`/v1/turns/${pending.turnId}/tool-results`, { results: [{ id: 'req-1', output: 'x' }] })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Turn not found or expired' })
  })

  it('ADEV-244: an unknown turn id is 404', async () => {
    await boot(new FakeClient(answer('x')))
    const res = await post('/v1/turns/00000000-0000-0000-0000-000000000000/tool-results', {
      results: [{ id: 'a', output: 'b' }],
    })
    expect(res.status).toBe(404)
  })

  it('ADEV-244: a session error fails the turn with 502 and deletes the session', async () => {
    await boot(
      new FakeClient((s) =>
        s.emit('session.error', { errorType: 'authentication', statusCode: 401, message: `bad token ${TOKEN}` })
      )
    )
    const res = await post('/v1/turns', turnBody())
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toContain('authentication')
    expect(JSON.stringify(body)).not.toContain(TOKEN)
    expect(client.deleted).toEqual(['session-1'])
  })

  it('ADEV-244: a malformed body is 400 and never echoes the token', async () => {
    await boot(new FakeClient(answer('x')))
    const res = await post('/v1/turns', { githubToken: TOKEN, model: 'gpt-5' })
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).not.toContain(TOKEN)
  })

  it('ADEV-244: neither the user token nor the shared secret appears in any log line', async () => {
    await boot(
      new FakeClient(
        (s) => s.emit('external_tool.requested', { requestId: 'r', toolName: 'get_repository_file', arguments: {} }),
        (s) => s.emit('session.error', { errorType: 'quota', message: `runtime echoed ${TOKEN} and ${SECRET}` })
      )
    )
    const pending = await (await post('/v1/turns', turnBody())).json()
    await post(`/v1/turns/${pending.turnId}/tool-results`, { results: [{ id: 'r', output: 'x' }] })
    await post('/v1/turns', turnBody(), `Bearer ${SECRET}-wrong`)
    await post('/v1/turns', { githubToken: TOKEN })

    // A session the runtime refuses, with the token in its error text.
    client.createSession = async () => {
      throw new Error(`token validation failed for ${TOKEN}`)
    }
    expect((await post('/v1/turns', turnBody())).status).toBe(502)

    expect(logLines.some((l) => l.includes('createSession failed'))).toBe(true)
    expect(logLines.length).toBeGreaterThan(3)
    const all = logLines.join('\n')
    expect(all).toContain('[redacted]')
    expect(all).not.toContain(TOKEN)
    expect(all).not.toContain(SECRET)
  })
})

describe('MemorySessionFs (ADEV-244)', () => {
  it('keeps session state in memory', async () => {
    const fs = new MemorySessionFs()
    await fs.writeFile('/state/a/events.jsonl', 'one\n')
    await fs.appendFile('/state/a/events.jsonl', 'two\n')
    expect(await fs.readFile('/state/a/events.jsonl')).toBe('one\ntwo\n')
    expect(await fs.readdir('/state')).toEqual(['a'])
    expect(await fs.readdirWithTypes('/state/a')).toEqual([{ name: 'events.jsonl', type: 'file' }])
    expect((await fs.stat('/state/a')).isDirectory).toBe(true)
    await fs.rename('/state/a', '/state/b')
    expect(await fs.exists('/state/b/events.jsonl')).toBe(true)
    await fs.rm('/state', true, false)
    expect(await fs.exists('/state')).toBe(false)
    await expect(fs.readFile('/missing')).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
