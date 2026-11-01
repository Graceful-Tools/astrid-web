/**
 * Regression for AWTD-1459 (finding W2): the lastEventCheck race.
 *
 * A local broadcast used to set `connection.lastEventCheck = Date.now()`, so an
 * event ANOTHER instance had written to the user's sorted set a moment earlier
 * fell below the next poll's lower bound and was never delivered.
 *
 * Driven through the public sse-utils surface the SSE routes use, against an
 * in-memory Upstash shared by "this" instance and a simulated other one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeUpstashStore, createFakeUpstash, writeRemoteEvent } from '../integration/realtime/fake-upstash'

const shared = vi.hoisted(() => ({ store: null as any }))

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor() {
      return createFakeUpstash(shared.store) as any
    }
  },
}))

function captureController() {
  const decoder = new TextDecoder()
  const frames: any[] = []
  const controller = {
    enqueue(chunk: Uint8Array) {
      const text = decoder.decode(chunk)
      const m = text.match(/^data: ([\s\S]+)\n\n$/)
      if (m) frames.push(JSON.parse(m[1]))
    },
    close() {},
  } as unknown as ReadableStreamDefaultController
  return { controller, frames }
}

/** Let one remote poll (the bus's 15 s cadence) run. */
async function poll() {
  await vi.advanceTimersByTimeAsync(16_000)
}

describe('SSE cross-instance delivery (AWTD-1459 lastEventCheck race)', () => {
  const T0 = 1_800_000_000_000
  let sse: any

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(T0)
    shared.store = new FakeUpstashStore()
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://fake.upstash.io')
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'fake-token')
    vi.stubEnv('REALTIME_BUS', '')
    vi.resetModules()
    globalThis.__sseConnections = undefined
    ;(globalThis as any).__realtimeBus = undefined
    sse = await import('@/lib/sse-utils')
  })

  afterEach(async () => {
    await (globalThis as any).__realtimeBus?.close()
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('AWTD-1459: an event another instance wrote 1 ms before a local delivery is still delivered', async () => {
    const userId = 'user-race'
    const { controller, frames } = captureController()
    sse.registerConnection(userId, controller)

    vi.setSystemTime(T0 + 10)
    writeRemoteEvent(shared.store, userId, { type: 'task_updated', timestamp: new Date(T0 + 10).toISOString(), data: { taskId: 'remote-task' } }, T0 + 10)

    vi.setSystemTime(T0 + 11)
    await sse.broadcastToUsers([userId], { type: 'task_created', data: { taskId: 'local-task' } })

    await poll()

    const taskIds = frames.map(f => f.data?.taskId)
    expect(taskIds).toContain('local-task')
    expect(taskIds).toContain('remote-task')
  })

  it('AWTD-1459: an event delivered locally is not delivered a second time by the remote poll', async () => {
    // The web client only suppresses repeats within 1 s and iOS not at all, so
    // the race fix must not trade a lost event for a duplicated one.
    const userId = 'user-dup'
    const { controller, frames } = captureController()
    sse.registerConnection(userId, controller)

    vi.setSystemTime(T0 + 5)
    await sse.broadcastToUsers([userId], { type: 'task_created', data: { taskId: 'once' } })

    await poll()
    await poll()

    expect(frames.filter(f => f.data?.taskId === 'once')).toHaveLength(1)
  })

  it('AWTD-1459: the wire frame is unchanged — `data: {type,timestamp,data}` locally and from the remote poll', async () => {
    const userId = 'user-wire'
    const raw: string[] = []
    const decoder = new TextDecoder()
    sse.registerConnection(userId, { enqueue: (c: Uint8Array) => raw.push(decoder.decode(c)), close() {} } as any)

    const timestamp = '2027-01-15T08:00:00.000Z'
    await sse.broadcastToUsers([userId], { type: 'task_updated', timestamp, data: { taskId: 't1', user: { id: 'u', email: 'e@x', password: 'no' } } })
    const remote = { type: 'task_deleted', timestamp, data: { taskId: 't2' } }
    writeRemoteEvent(shared.store, userId, remote, Date.now() + 1)
    await poll()

    expect(raw).toEqual([
      `data: ${JSON.stringify({ type: 'task_updated', timestamp, data: { taskId: 't1', user: { id: 'u', email: 'e@x' } } })}\n\n`,
      `data: ${JSON.stringify(remote)}\n\n`,
    ])
  })
})
