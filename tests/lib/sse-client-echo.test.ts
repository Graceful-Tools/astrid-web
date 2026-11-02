/**
 * AWTD-1497 — the tab that made an edit never hears it back; the same person's
 * other tabs and devices do.
 *
 * Driven through the public sse-utils surface the SSE route uses, on the
 * in-memory Upstash the cross-instance test uses, so a replayed event goes
 * through the same filter as a live one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FakeUpstashStore, createFakeUpstash } from '../integration/realtime/fake-upstash'

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
      const m = decoder.decode(chunk).match(/^data: ([\s\S]+)\n\n$/)
      if (m) frames.push(JSON.parse(m[1]))
    },
    close() {},
  } as unknown as ReadableStreamDefaultController
  return { controller, frames }
}

const USER = 'user-echo'
const TAB = 'web_tab_that_toggled'
const OTHER = 'web_the_other_device'

describe('a client never hears its own edit back (AWTD-1497)', () => {
  let sse: any

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
    vi.setSystemTime(1_800_000_000_000)
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

  const completed = { type: 'task_completed', data: { taskId: 't1' } }

  it('the originating connection skips the event; the other connection gets it', async () => {
    const origin = captureController()
    const other = captureController()
    sse.registerConnection(USER, origin.controller, { clientId: TAB })
    sse.registerConnection(USER, other.controller, { clientId: OTHER })

    await sse.broadcastToUsers([USER], completed, { originClientId: TAB })

    expect(origin.frames.map(f => f.type)).not.toContain('task_completed')
    expect(other.frames.map(f => f.data?.taskId)).toEqual(['t1'])
  })

  it('a connection that sent no client id (older iOS) still gets the event', async () => {
    const legacy = captureController()
    sse.registerConnection(USER, legacy.controller)
    await sse.broadcastToUsers([USER], completed, { originClientId: TAB })
    expect(legacy.frames.map(f => f.data?.taskId)).toEqual(['t1'])
  })

  it('an untagged event reaches every connection, as before', async () => {
    const origin = captureController()
    sse.registerConnection(USER, origin.controller, { clientId: TAB })
    await sse.broadcastToUsers([USER], completed)
    expect(origin.frames.map(f => f.data?.taskId)).toEqual(['t1'])
  })

  it('a reconnect replay also skips the client\'s own event', async () => {
    await sse.broadcastToUsers([USER], completed, { originClientId: TAB })
    await sse.broadcastToUsers([USER], { type: 'task_updated', data: { taskId: 't2' } }, { originClientId: OTHER })

    const reconnected = captureController()
    sse.registerConnection(USER, reconnected.controller, { clientId: TAB, since: 1 })
    await vi.advanceTimersByTimeAsync(100)

    expect(reconnected.frames.map(f => f.data?.taskId)).toEqual(['t2'])
  })
})
