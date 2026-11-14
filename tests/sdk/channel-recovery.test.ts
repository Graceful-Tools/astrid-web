/**
 * @vitest-environment node
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { astridChannel } from '../../packages/astrid-sdk/src/channel/channel'
import { DeliveryLedger } from '../../packages/astrid-sdk/src/channel/delivery-ledger'
import type { AgentTask } from '../../packages/astrid-sdk/src/channel/types'
import { frame } from '../fixtures/sdk-sse'
import { BRAND } from '@/lib/brand/config'

const SCOUT = `scout.oc@${BRAND.agentEmailDomain}`

const SERVER_TIME = Date.parse('2026-11-08T12:00:00Z')
const task = (id: string): AgentTask => ({
  id, title: `Work ${id}`, description: '', priority: 0, completed: false,
  dueDateTime: null, isAllDay: false, listId: null, listName: null,
  listDescription: null, assignerName: null, assignerId: null, comments: [],
  createdAt: new Date(SERVER_TIME).toISOString(), updatedAt: new Date(SERVER_TIME).toISOString(),
})
const assigned = (id: string) => frame({ taskId: id, task: task(id) }, { event: 'task.assigned' })

let directory: string
let pending: AgentTask[]
let streams: (string[] | Response)[]
let requests: string[]
let adapters: ReturnType<typeof astridChannel.createAdapter>[]
let attention: { id: string; completed: boolean; statusRole: string; lastComment: { id: string } }[]
let claims: Response[]
let detailResponses: Map<string, (AgentTask | null)[]>
let claimBodies: unknown[]

// The real GET /api/v1/agent-queue identity contract (lib/agent-queue.ts, AWTD-1642):
// a pollable built-in mailbox, or a Custom Agent address `<name>.oc[@domain]` for the
// agent's own token. Anything else is the same 400 the server sends for a typo.
const POLLABLE = ['claude', 'copilot', 'openai', 'gemini']
const queueAgentAccepted = (agent: string | null) => {
  if (!agent) return false
  const email = agent.includes('@') ? agent.toLowerCase() : `${agent}@${BRAND.agentEmailDomain}`
  if (!email.endsWith(`@${BRAND.agentEmailDomain}`)) return false
  const local = email.slice(0, email.lastIndexOf('@'))
  return /^[a-z0-9._-]+\.oc$/.test(local) || POLLABLE.includes(local)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(SERVER_TIME)
  directory = mkdtempSync(join(tmpdir(), 'astrid-sdk-recovery-'))
  pending = []
  streams = []
  requests = []
  adapters = []
  attention = []
  claims = []
  detailResponses = new Map()
  claimBodies = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    requests.push(url)
    if (url.endsWith('/oauth/token')) {
      return Response.json({ access_token: 'test-token', expires_in: 3600 })
    }
    if (url.includes('/agent/tasks?')) return Response.json({ tasks: pending })
    if (url.includes('/agent-queue?')) {
      const agent = new URL(url).searchParams.get('agent')
      if (!queueAgentAccepted(agent)) return Response.json({ error: `Unknown agent "${agent}"` }, { status: 400 })
      return Response.json({
        queue: pending.map(item => ({ id: item.id })), truncated: false,
        attention: { tasks: attention, messages: [], truncated: false, skipped: [] },
      })
    }
    if (url.endsWith('/comments') && init?.method === 'POST') {
      return Response.json({ comment: { id: 'posted', content: JSON.parse(String(init.body)).content } })
    }
    if (url.endsWith('/claim')) {
      claimBodies.push(JSON.parse(String(init?.body)))
      return claims.shift() ?? Response.json({ error: 'Not found' }, { status: 404 })
    }
    if (/\/agent\/tasks\/[^/?]+$/.test(url)) {
      const id = url.split('/').pop()!
      const scripted = detailResponses.get(id)
      if (scripted?.length) {
        const detail = scripted.shift()
        return detail ? Response.json({ task: detail }) : Response.json({ error: 'Task not found' }, { status: 404 })
      }
      return Response.json({ task: {
        ...task(id),
        comments: attention.some(entry => entry.id === id)
          ? [{ id: 'reply', content: 'Please continue', authorId: 'human', authorName: 'Human', isAgent: false, createdAt: new Date(SERVER_TIME).toISOString() }]
          : [],
      } })
    }
    if (url.includes('/agent/events')) {
      const chunks = streams.shift()
      if (!chunks) throw new Error(`Unexpected stream: ${url}`)
      if (chunks instanceof Response) return chunks
      return new Response(new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
          controller.close()
        },
      }))
    }
    throw new Error(`Unexpected request: ${url}`)
  }))
})

afterEach(async () => {
  for (const adapter of adapters) await adapter.disconnect()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  rmSync(directory, { recursive: true, force: true })
})

function adapter(agentMailbox = 'copilot') {
  const config = {
    enabled: true, clientId: 'test-client', clientSecret: 'test-secret',
    apiBase: 'https://sdk-test.example/api/v1',
    recovery: { stateFile: join(directory, 'delivery.json'), agentMailbox },
  }
  const result = astridChannel.createAdapter(config)
  adapters.push(result)
  return result
}

function legacyAdapter() {
  const result = astridChannel.createAdapter({
    enabled: true, clientId: 'test-client', clientSecret: 'test-secret',
    apiBase: 'https://sdk-test.example/api/v1',
  })
  adapters.push(result)
  return result
}

const keepalive = (time: number) => frame({ serverTime: new Date(time).toISOString() }, { event: 'keepalive' })
const persisted = () => {
  try {
    return JSON.parse(readFileSync(join(directory, 'delivery.json'), 'utf8'))
  } catch {
    return {}
  }
}
const eventSince = (index: number) =>
  new URL(requests.filter(url => url.includes('/agent/events')).at(index)!).searchParams.get('since')

function stream(time = SERVER_TIME, ...events: string[]) {
  streams.push([frame({ timestamp: new Date(time).toISOString() }, { event: 'connected' }), ...events])
}

describe('AWTD-1565 SDK channel recovery', () => {
  it('AWTD-1565 delivers a pending assigned task exactly once across restart', async () => {
    pending = [task('pending')]
    const first = adapter()
    await first.init()
    stream()
    const received = vi.fn()
    await first.connect(received)
    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].sessionKey).toBe('astrid:task:pending')
    await first.disconnect()

    const restarted = adapter()
    await restarted.init()
    stream()
    await restarted.connect(received)
    expect(received).toHaveBeenCalledTimes(1)
    expect(restarted.getHealth().activeSessions).toBe(1)
    expect(JSON.parse(readFileSync(join(directory, 'delivery.json'), 'utf8')).entries.map((entry: { key: string }) => entry.key)).toEqual(['task:pending'])
  })

  it('AWTD-1565 dedupes the queue and repeated assignment events by task id', async () => {
    pending = [task('same')]
    const client = adapter()
    await client.init()
    stream(SERVER_TIME, assigned('same'), assigned('same'))
    const received = vi.fn()
    await client.connect(received)
    stream(SERVER_TIME + 6 * 60_000, assigned('same'))
    vi.setSystemTime(SERVER_TIME + 6 * 60_000)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(received).toHaveBeenCalledTimes(1)
  })

  it('AWTD-1565 uses a private ledger and rejects another agent scope', async () => {
    pending = [task('same')]
    const client = adapter()
    await client.init()
    stream()
    await client.connect(vi.fn())
    expect(statSync(join(directory, 'delivery.json')).mode & 0o777).toBe(0o600)
    expect(() => astridChannel.createAdapter({
      enabled: true, clientId: 'another-client', clientSecret: 'test-secret',
      apiBase: 'https://sdk-test.example/api/v1',
      recovery: { stateFile: join(directory, 'delivery.json'), agentMailbox: 'copilot' },
    })).toThrow('different agent scope')
  })

  it('AWTD-1565 surfaces a corrupt persisted ledger instead of silently replaying work', () => {
    writeFileSync(join(directory, 'delivery.json'), '{}')
    expect(adapter).toThrow('invalid ledger')
  })

  it.each(['task.completed', 'task.deleted'])(
    'AWTD-1565 removes a terminal task from the ledger on %s so it can be delivered again',
    async type => {
      detailResponses.set('reopened', [type === 'task.deleted' ? null : { ...task('reopened'), completed: true }])
      const client = adapter()
      await client.init()
      stream(SERVER_TIME, assigned('reopened'), frame({ taskId: 'reopened' }, { event: type }), assigned('reopened'))
      const received = vi.fn()
      await client.connect(received)
      expect(received).toHaveBeenCalledTimes(2)
    },
  )

  it('AWTD-1565 retries a failed callback without recording successful delivery', async () => {
    pending = [task('retry')]
    const client = adapter()
    await client.init()
    stream()
    const received = vi.fn().mockImplementationOnce(() => { throw new Error('consumer failed') })
    await expect(client.connect(received)).rejects.toThrow('consumer failed')
    stream()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await vi.advanceTimersByTimeAsync(10_000)
    expect(received).toHaveBeenCalledTimes(2)
    expect(JSON.parse(readFileSync(join(directory, 'delivery.json'), 'utf8')).entries.map((entry: { key: string }) => entry.key)).toEqual(['task:retry'])
  })

  it('AWTD-1565 detects a retention gap and reconciles missing events from the queue', async () => {
    const client = adapter()
    await client.init()
    stream(SERVER_TIME, keepalive(SERVER_TIME + 30_000))
    const received = vi.fn()
    await client.connect(received)
    pending = [task('missed')]
    stream(SERVER_TIME + 20 * 60_000)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await vi.advanceTimersByTimeAsync(10_000)
    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].sessionKey).toBe('astrid:task:missed')
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('replay retention gap'))
    expect(requests.filter(url => url.includes('/agent-queue?')).length).toBeGreaterThanOrEqual(2)
  })

  it('AWTD-1565 reconciles attention and dedupes a replay of its comment', async () => {
    pending = [task('conversation')]
    const client = adapter()
    await client.init()
    stream()
    const received = vi.fn()
    await client.connect(received)
    pending = []
    attention = [{ id: 'conversation', completed: false, statusRole: 'doing', lastComment: { id: 'reply' } }]
    stream(SERVER_TIME + 5_000, frame({
      taskId: 'conversation',
      comment: { id: 'reply', content: 'Please continue' },
    }, { event: 'task.commented' }))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(received).toHaveBeenCalledTimes(2)
    expect(received.mock.calls[1][0].metadata.commentId).toBe('reply')
  })

  it('AWTD-1565 restores a delivered Doing session even when it is absent from Ready and attention', async () => {
    pending = [task('doing')]
    const first = adapter()
    await first.init()
    stream()
    await first.connect(vi.fn())
    await first.disconnect()
    pending = []
    const restarted = adapter()
    await restarted.init()
    stream(SERVER_TIME, frame({
      taskId: 'doing', comment: { id: 'reply', content: 'Please continue' },
    }, { event: 'task.commented' }))
    const received = vi.fn()
    await restarted.connect(received)
    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].metadata.commentId).toBe('reply')
  })

  it('AWTD-1565 does not replay comments already accepted as part of task history', async () => {
    pending = [task('history')]
    attention = [{ id: 'history', completed: false, statusRole: 'ready', lastComment: { id: 'reply' } }]
    const client = adapter()
    await client.init()
    stream(SERVER_TIME, frame({
      taskId: 'history', comment: { id: 'reply', content: 'Please continue' },
    }, { event: 'task.commented' }))
    const received = vi.fn()
    await client.connect(received)
    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].content).toContain('Please continue')
  })

  it('AWTD-1565 leaves legacy startup and replay behavior unchanged when recovery is unset', async () => {
    pending = [task('legacy')]
    const client = astridChannel.createAdapter({
      enabled: true, clientId: 'test-client', clientSecret: 'test-secret',
      apiBase: 'https://sdk-test.example/api/v1',
    })
    adapters.push(client)
    await client.init()
    stream(SERVER_TIME, assigned('legacy'))
    const received = vi.fn()
    await client.connect(received)
    expect(received).not.toHaveBeenCalled()
    expect(requests.some(url => url.includes('/agent-queue?') || url.endsWith('/claim'))).toBe(false)
    expect(new URL(requests.find(url => url.includes('/agent/events'))!).searchParams.get('since'))
      .toBe(new Date(SERVER_TIME).toISOString())
  })

  it('AWTD-1565 feature-detects a successful claim and skips a peer-owned task', async () => {
    pending = [task('mine'), task('peer')]
    claims = [
      Response.json({ outcome: 'claimed', task: { id: 'mine' } }),
      Response.json({ outcome: 'conflict', task: { id: 'peer' } }, { status: 409 }),
      Response.json({ outcome: 'conflict', task: { id: 'peer' } }, { status: 409 }),
    ]
    const client = adapter()
    await client.init()
    stream(SERVER_TIME, assigned('peer'))
    const received = vi.fn()
    await client.connect(received)
    expect(received.mock.calls.map(([msg]) => msg.sessionKey)).toEqual(['astrid:task:mine'])
    expect(requests.filter(url => url.endsWith('/claim'))).toHaveLength(3)
  })

  it('AWTD-1565 treats a body-shaped not_found as a skipped task, not a disabled API', async () => {
    pending = [task('gone'), task('mine')]
    claims = [
      Response.json({ outcome: 'not_found', task: null }, { status: 404 }),
      Response.json({ outcome: 'claimed', task: { id: 'mine' } }),
    ]
    const client = adapter()
    await client.init()
    stream()
    const received = vi.fn()
    await client.connect(received)
    expect(received.mock.calls.map(([msg]) => msg.sessionKey)).toEqual(['astrid:task:mine'])
    expect(requests.filter(url => url.endsWith('/claim'))).toHaveLength(2)
  })

  it('AWTD-1565 falls back once when the claim route is off and caches that result', async () => {
    pending = [task('one'), task('two')]
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = adapter()
    await client.init()
    stream()
    const received = vi.fn()
    await client.connect(received)
    expect(received).toHaveBeenCalledTimes(2)
    expect(requests.filter(url => url.endsWith('/claim'))).toHaveLength(1)
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('claim API unavailable'))
  })

  it.each([
    [403, { outcome: 'forbidden', task: null }],
    [405, { error: 'Method not allowed' }],
    [501, { error: 'Not implemented' }],
    [200, { outcome: 'released', task: { id: 'one' } }],
    [200, { outcome: 'claimed', task: { id: 'wrong-task' } }],
  ])('AWTD-1565 treats unusable claim status %i as a warned, cached fallback', async (status, body) => {
    pending = [task('one'), task('two')]
    claims = [Response.json(body, { status })]
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = adapter()
    await client.init()
    stream()
    const received = vi.fn()
    await client.connect(received)
    expect(received).toHaveBeenCalledTimes(2)
    expect(requests.filter(url => url.endsWith('/claim'))).toHaveLength(1)
    expect(warning.mock.calls.filter(([message]) => String(message).includes('claim API unavailable'))).toHaveLength(1)
  })

  it('AWTD-1565 bounds the ledger by receipt count and server-time age, not client time', () => {
    const ledger = new DeliveryLedger(join(directory, 'delivery.json'), 'https://sdk-test.example/api/v1', 'test-client', 'copilot')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (let index = 0; index < 1001; index++) ledger.delivered(String(index))
    expect(ledger.has('0')).toBe(false)
    expect(ledger.has('1000')).toBe(true)
    ledger.observeServerTime(SERVER_TIME)
    vi.setSystemTime(SERVER_TIME + 100 * 24 * 60 * 60_000)
    expect(ledger.has('1000')).toBe(true)
    ledger.observeServerTime(SERVER_TIME + 31 * 24 * 60 * 60_000)
    expect(ledger.has('1000')).toBe(false)
    expect(warning.mock.calls.map(([message]) => message)).toEqual([
      expect.stringContaining('capacity exceeded'), expect.stringContaining('age limit reached'),
    ])
  })

  it('AWTD-1565 waits for asynchronous consumer acceptance before recording delivery', async () => {
    pending = [task('async')]
    const client = adapter()
    await client.init()
    stream()
    const received = vi.fn().mockRejectedValueOnce(new Error('queue unavailable')).mockResolvedValue(undefined)
    await expect(client.connect(received)).rejects.toThrow('queue unavailable')
    stream()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(received).toHaveBeenCalledTimes(2)
  })

  it('AWTD-1565 retries a claimed task after it leaves Ready and the process restarts', async () => {
    pending = [task('claimed')]
    claims = [Response.json({ outcome: 'claimed', task: { id: 'claimed' } })]
    const first = adapter()
    await first.init()
    stream()
    await expect(first.connect(vi.fn().mockRejectedValue(new Error('consumer unavailable'))))
      .rejects.toThrow('consumer unavailable')
    await first.disconnect()
    pending = []
    claims = [Response.json({ outcome: 'already_yours', task: { id: 'claimed' } })]
    const restarted = adapter()
    await restarted.init()
    stream()
    const received = vi.fn()
    await restarted.connect(received)
    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].sessionKey).toBe('astrid:task:claimed')
  })

  it('AWTD-1565 accepts attention arriving after pending history acceptance but before queue reconciliation', async () => {
    const ledger = new DeliveryLedger(join(directory, 'delivery.json'), 'https://sdk-test.example/api/v1', 'test-client', 'copilot')
    ledger.begin('racing-reply')
    const client = adapter()
    await client.init()
    stream(SERVER_TIME, frame({
      taskId: 'racing-reply', comment: { id: 'reply', content: 'Please continue' },
    }, { event: 'task.commented' }))
    const received = vi.fn().mockImplementationOnce(() => {
      attention = [{ id: 'racing-reply', completed: false, statusRole: 'doing', lastComment: { id: 'reply' } }]
    })
    await client.connect(received)
    expect(received).toHaveBeenCalledTimes(2)
    expect(received.mock.calls[1][0].metadata.commentId).toBe('reply')
  })

  it.each(['task.completed', 'task.deleted'])(
    'AWTD-1565 ignores stale %s replay after accepting the current reopened Ready task',
    async type => {
      pending = [task('current')]
      const client = adapter()
      await client.init()
      stream(SERVER_TIME, frame({ taskId: 'current' }, { event: type }), assigned('current'))
      const received = vi.fn()
      await client.connect(received)
      expect(received).toHaveBeenCalledTimes(1)
      expect(client.getHealth().activeSessions).toBe(1)
    },
  )

  it('AWTD-1565 logs rejected legacy consumer callbacks without an unhandled rejection', async () => {
    const client = astridChannel.createAdapter({
      enabled: true, clientId: 'test-client', clientSecret: 'test-secret',
      apiBase: 'https://sdk-test.example/api/v1',
    })
    adapters.push(client)
    await client.init()
    stream(SERVER_TIME, assigned('throws'))
    const error = new Error('consumer failed')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    await client.connect(() => { throw error })
    await Promise.resolve()
    expect(logged).toHaveBeenCalledWith('SSE handler error:', error)
  })

  it.each(['consumer', 'ledger'])(
    'AWTD-1565 reconnects after live %s failure before advancing past unaccepted comments',
    async failure => {
      const ledger = new DeliveryLedger(join(directory, 'delivery.json'), 'https://sdk-test.example/api/v1', 'test-client', 'copilot')
      ledger.observeServerTime(SERVER_TIME)
      const client = adapter()
      await client.init()
      const commentFrame = frame({
        taskId: 'live', comment: { id: 'reply', content: 'retry me' },
      }, { event: 'task.commented' })
      stream(SERVER_TIME + 120_000, assigned('live'), commentFrame,
        frame({ serverTime: new Date(SERVER_TIME + 120_000).toISOString() }, { event: 'keepalive' }))
      const error = new Error('acceptance failed')
      const received = vi.fn()
      if (failure === 'consumer') {
        received.mockImplementationOnce(() => {}).mockRejectedValueOnce(error)
      } else {
        vi.spyOn(DeliveryLedger.prototype, 'commented').mockImplementationOnce(() => { throw error })
      }
      await expect(client.connect(received)).rejects.toThrow('acceptance failed')
      expect(JSON.parse(readFileSync(join(directory, 'delivery.json'), 'utf8')).lastServerTime).toBe(SERVER_TIME)
      stream(SERVER_TIME, commentFrame)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(received).toHaveBeenCalledTimes(3)
    },
  )

  it('AWTD-1565 skips unreadable attention without blocking buffered work', async () => {
    attention = [{ id: 'human-handback', completed: false, statusRole: 'waiting', lastComment: { id: 'reply' } }]
    detailResponses.set('human-handback', [null])
    const client = adapter()
    await client.init()
    stream(SERVER_TIME, assigned('unrelated'))
    const received = vi.fn()
    await expect(client.connect(received)).resolves.toBeUndefined()
    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].sessionKey).toBe('astrid:task:unrelated')
  })

  it.each([-24 * 60 * 60_000, 24 * 60 * 60_000])(
    'AWTD-1565 clock skew of %i ms neither skips new work nor duplicates delivery',
    async skew => {
      vi.setSystemTime(SERVER_TIME + skew)
      const client = adapter()
      await client.init()
      stream(SERVER_TIME, assigned('first'), keepalive(SERVER_TIME + 30_000))
      const received = vi.fn()
      await client.connect(received)
      vi.setSystemTime(SERVER_TIME - skew)
      pending = [task('first'), task('second')]
      stream(SERVER_TIME + 5_000, assigned('first'), assigned('second'))
      await vi.advanceTimersByTimeAsync(10_000)
      expect(received.mock.calls.map(([msg]) => msg.sessionKey)).toEqual([
        'astrid:task:first', 'astrid:task:second',
      ])
      const urls = requests.filter(url => url.includes('/agent/events'))
      expect(new URL(urls[0]).searchParams.get('since')).toBe(new Date(1).toISOString())
      // The cursor is server time from the keepalive, minus the replay overlap.
      expect(new URL(urls[1]).searchParams.get('since')).toBe(new Date(SERVER_TIME).toISOString())
    },
  )

  // ── 2026-11-10 review blockers ─────────────────────────────────────────────

  it('AWTD-1565 legacy path: a throwing consumer keeps the session, later comments and send()', async () => {
    const client = legacyAdapter()
    await client.init()
    stream(SERVER_TIME, assigned('legacy'), frame({
      taskId: 'legacy', comment: { id: 'follow-up', content: 'One more thing' },
    }, { event: 'task.commented' }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const received = vi.fn().mockImplementationOnce(() => { throw new Error('consumer failed') })
    await client.connect(received)
    await vi.advanceTimersByTimeAsync(0)
    expect(received).toHaveBeenCalledTimes(2)
    expect(received.mock.calls[1][0].metadata.commentId).toBe('follow-up')
    expect(client.getHealth().activeSessions).toBe(1)
    await expect(client.send({ sessionKey: 'astrid:task:legacy', content: 'Done' })).resolves.toBeUndefined()
  })

  it('AWTD-1565 legacy path: a rejecting consumer keeps the session for later comments', async () => {
    const client = legacyAdapter()
    await client.init()
    stream(SERVER_TIME, assigned('legacy'), frame({
      taskId: 'legacy', comment: { id: 'follow-up', content: 'One more thing' },
    }, { event: 'task.commented' }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const received = vi.fn().mockRejectedValueOnce(new Error('consumer failed'))
    await client.connect(received)
    await vi.advanceTimersByTimeAsync(0)
    expect(received).toHaveBeenCalledTimes(2)
    expect(client.getHealth().activeSessions).toBe(1)
  })

  it('AWTD-1565 does not advance the replay cursor past a received but unaccepted comment; restart replays it once', async () => {
    pending = [task('doing')]
    const first = adapter()
    await first.init()
    stream(SERVER_TIME, keepalive(SERVER_TIME + 30_000))
    await first.connect(vi.fn())
    await first.disconnect()
    expect(persisted().lastServerTime).toBe(SERVER_TIME + 30_000)

    // Ten minutes later the server replays a five-minute-old reply on connect.
    const restartTime = SERVER_TIME + 10 * 60_000
    vi.setSystemTime(restartTime)
    const reply = frame({
      taskId: 'doing', comment: { id: 'old-reply', content: 'Answer from five minutes ago' },
    }, { event: 'task.commented' })
    const crashed = adapter()
    await crashed.init()
    stream(restartTime, reply, keepalive(restartTime + 5_000))
    const neverAccepts = vi.fn(() => new Promise<void>(() => {}))
    void crashed.connect(neverAccepts)
    await vi.advanceTimersByTimeAsync(0)
    expect(neverAccepts).toHaveBeenCalledTimes(1)
    await crashed.disconnect() // the process dies before the consumer accepts
    expect(persisted().lastServerTime).toBe(SERVER_TIME + 30_000)

    const restarted = adapter()
    await restarted.init()
    stream(restartTime + 1_000, reply)
    const received = vi.fn()
    await restarted.connect(received)
    expect(eventSince(-1)).toBe(new Date(SERVER_TIME).toISOString())
    expect(received).toHaveBeenCalledTimes(1)
    expect(received.mock.calls[0][0].metadata.commentId).toBe('old-reply')
  })

  it('AWTD-1565 advances the replay cursor only on a keepalive after the replay window settles', async () => {
    const client = adapter()
    await client.init()
    stream(SERVER_TIME, keepalive(SERVER_TIME + 5_000))
    await client.connect(vi.fn())
    expect(persisted().lastServerTime).toBeUndefined()
    stream(SERVER_TIME + 60_000, keepalive(SERVER_TIME + 95_000))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(persisted().lastServerTime).toBe(SERVER_TIME + 95_000)
  })

  it('AWTD-1565 reconciles a Custom Agent by its own address and claims with its mailbox', async () => {
    pending = [task('custom')]
    claims = [Response.json({ outcome: 'claimed', task: { id: 'custom' } })]
    const client = adapter(SCOUT)
    await client.init()
    stream()
    const received = vi.fn()
    await client.connect(received)
    expect(received).toHaveBeenCalledTimes(1)
    expect(new URL(requests.find(url => url.includes('/agent-queue?'))!).searchParams.get('agent'))
      .toBe(SCOUT)
    expect(claimBodies).toEqual([{ action: 'claim', agentMailbox: 'scout.oc' }])
  })

  it('AWTD-1565 surfaces the queue identity error instead of reconciling nothing', async () => {
    const client = adapter('not-an-agent')
    await client.init()
    stream()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(client.connect(vi.fn())).rejects.toThrow('Unknown agent')
  })

  it.each([
    [500, { error: 'Internal server error' }],
    [429, { error: 'Too many requests' }],
    [503, { error: 'Service unavailable' }],
  ])('AWTD-1565 a transient claim failure (%i) does not disable claiming for the process', async (status, body) => {
    pending = [task('one'), task('two')]
    claims = [Response.json(body, { status }), Response.json({ outcome: 'claimed', task: { id: 'two' } })]
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = adapter()
    await client.init()
    stream()
    const received = vi.fn()
    await client.connect(received)
    expect(received).toHaveBeenCalledTimes(2)
    expect(requests.filter(url => url.endsWith('/claim'))).toHaveLength(2)
    expect(warning.mock.calls.some(([message]) => String(message).includes('claim API unavailable'))).toBe(false)
  })

  it('AWTD-1565 drops a finished task\'s comment receipts so they cannot evict live work', () => {
    const ledger = new DeliveryLedger(join(directory, 'delivery.json'), 'https://sdk-test.example/api/v1', 'test-client', 'copilot')
    ledger.delivered('done', ['history'])
    ledger.commented('done', 'reply')
    ledger.delivered('live')
    ledger.end('done')
    expect(persisted().entries.map((entry: { key: string }) => entry.key)).toEqual(['task:live'])
  })

  it.each(['', '{"version":1,"scope":"abc","entr'])(
    'AWTD-1565 starts a fresh ledger with a warning when the file is empty or truncated (%j)',
    raw => {
      writeFileSync(join(directory, 'delivery.json'), raw)
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(adapter).not.toThrow()
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('unreadable'))
    },
  )
})
