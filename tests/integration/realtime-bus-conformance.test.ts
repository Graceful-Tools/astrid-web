// @vitest-environment node
/**
 * RealtimeBus conformance (AWTD-1459, PLATFORM_ASSESSMENT_2026-11 W2/A2 §5).
 *
 * The SAME assertions against every implementation, each run as two bus
 * instances sharing one backend — two app replicas in miniature:
 *
 *   upstash  — lib/realtime/upstash-bus.ts over an in-memory Upstash
 *              (./realtime/fake-upstash.ts). Always runs.
 *   redis    — lib/realtime/redis-bus.ts over a REAL Redis server at
 *              REALTIME_TEST_REDIS_URL. CI provides one (unit-tests.yml
 *              `services: redis`); locally:
 *                redis-server --port 6390 &
 *                REALTIME_TEST_REDIS_URL=redis://localhost:6390 npx vitest run tests/integration/realtime-bus-conformance.test.ts
 *              Without it the suite is skipped, by name, rather than faked.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createUpstashBus } from '@/lib/realtime/upstash-bus'
import { createRedisBus } from '@/lib/realtime/redis-bus'
import type { RealtimeBus, RealtimeEnvelope, RealtimeEvent } from '@/lib/realtime/types'
import { FakeUpstashStore, createFakeUpstash } from './realtime/fake-upstash'

const REDIS_URL = process.env.REALTIME_TEST_REDIS_URL

interface Pair {
  a: RealtimeBus
  b: RealtimeBus
  /** Longest a cross-instance delivery may take on this transport. */
  crossInstanceMs: number
}

const UPSTASH_POLL_MS = 40

const implementations: Array<{ name: string; enabled: boolean; make: () => Pair }> = [
  {
    name: 'upstash (in-memory Upstash)',
    enabled: true,
    make: () => {
      const store = new FakeUpstashStore()
      return {
        a: createUpstashBus({ client: createFakeUpstash(store), pollMs: UPSTASH_POLL_MS }),
        b: createUpstashBus({ client: createFakeUpstash(store), pollMs: UPSTASH_POLL_MS }),
        crossInstanceMs: UPSTASH_POLL_MS * 6,
      }
    },
  },
  {
    name: REDIS_URL
      ? `redis (${REDIS_URL})`
      : 'redis (SKIPPED: set REALTIME_TEST_REDIS_URL to a Redis server to run against node-redis)',
    enabled: Boolean(REDIS_URL),
    make: () => ({
      a: createRedisBus({ url: REDIS_URL }),
      b: createRedisBus({ url: REDIS_URL }),
      crossInstanceMs: 1_000,
    }),
  },
]

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let seq = 0
const uid = (label: string) => `conf-${label}-${process.pid}-${Date.now()}-${++seq}`
const ev = (type: string, taskId: string): RealtimeEvent => ({ type, timestamp: new Date().toISOString(), data: { taskId } })
const taskIds = (got: RealtimeEnvelope[]) => got.map(e => (e.event.data as { taskId: string }).taskId)

async function waitFor(predicate: () => boolean, ms: number) {
  const deadline = Date.now() + ms
  while (!predicate()) {
    if (Date.now() > deadline) return false
    await sleep(5)
  }
  return true
}

/** Subscribe, then give a push transport time to have SUBSCRIBE acknowledged. */
async function listen(bus: RealtimeBus, userId: string, options?: Parameters<RealtimeBus['subscribe']>[2]) {
  const got: RealtimeEnvelope[] = []
  const off = bus.subscribe(userId, e => got.push(e), options)
  await sleep(bus.kind === 'redis' ? 100 : 0)
  return { got, off }
}

for (const impl of implementations) {
  describe.runIf(impl.enabled)(`RealtimeBus conformance — ${impl.name}`, () => {
    let pair: Pair

    afterEach(async () => {
      await pair?.a.close()
      await pair?.b.close()
    })

    it('delivers a local publish to local subscribers before publish resolves', async () => {
      pair = impl.make()
      const user = uid('local')
      const { got } = await listen(pair.a, user)
      const pending = pair.a.publish([user], ev('task_created', 'L1'))
      expect(taskIds(got)).toEqual(['L1'])
      await pending
    })

    it('delivers a publish on another instance', async () => {
      pair = impl.make()
      const user = uid('cross')
      const { got } = await listen(pair.a, user)
      await pair.b.publish([user], ev('task_updated', 'X1'))
      expect(await waitFor(() => got.length === 1, pair.crossInstanceMs)).toBe(true)
      expect(taskIds(got)).toEqual(['X1'])
    })

    it('AWTD-1459: an event published on another instance 1 ms before a local delivery is still delivered', async () => {
      pair = impl.make()
      const user = uid('race')
      const { got } = await listen(pair.a, user)
      await pair.b.publish([user], ev('task_updated', 'remote'))
      await sleep(1)
      await pair.a.publish([user], ev('task_created', 'local'))
      expect(await waitFor(() => got.length >= 2, pair.crossInstanceMs)).toBe(true)
      expect(new Set(taskIds(got))).toEqual(new Set(['remote', 'local']))
    })

    it('AWTD-1459: hands each event to a subscriber once, however many paths it arrives by', async () => {
      pair = impl.make()
      const user = uid('once')
      const { got } = await listen(pair.a, user, { since: Date.now() - 1 })
      await pair.a.publish([user], ev('task_created', 'mine'))
      await pair.b.publish([user], ev('task_created', 'theirs'))
      await sleep(pair.crossInstanceMs * 2)
      expect(taskIds(got).sort()).toEqual(['mine', 'theirs'])
    })

    it('fans one publish out to several users, on both instances', async () => {
      pair = impl.make()
      const [u1, u2] = [uid('fan1'), uid('fan2')]
      const one = await listen(pair.a, u1)
      const two = await listen(pair.b, u2)
      await pair.a.publish([u1, u2], ev('list_updated', 'F1'))
      expect(taskIds(one.got)).toEqual(['F1'])
      expect(await waitFor(() => two.got.length === 1, pair.crossInstanceMs)).toBe(true)
    })

    it('replaySince returns persisted events newer than the timestamp, oldest first, without ephemeral ones', async () => {
      pair = impl.make()
      const user = uid('replay')
      const before = Date.now() - 1
      await pair.b.publish([user], ev('task_created', 'R1'))
      await sleep(2)
      await pair.b.publish([user], ev('agent_typing_start', 'typing'), { persist: false })
      await pair.b.publish([user], ev('task_updated', 'R2'))
      await sleep(2)
      const cut = Date.now()
      await sleep(2)
      await pair.b.publish([user], ev('task_deleted', 'R3'))

      expect(taskIds(await pair.a.replaySince(user, before))).toEqual(['R1', 'R2', 'R3'])
      expect(taskIds(await pair.a.replaySince(user, cut))).toEqual(['R3'])
    })

    it('subscribe with `since` replays what was missed, then live events, each once', async () => {
      pair = impl.make()
      const user = uid('since')
      const since = Date.now() - 1
      await pair.b.publish([user], ev('task_created', 'missed'))
      const { got } = await listen(pair.a, user, { since })
      expect(await waitFor(() => got.length === 1, pair.crossInstanceMs)).toBe(true)
      await pair.b.publish([user], ev('task_updated', 'live'))
      expect(await waitFor(() => got.length === 2, pair.crossInstanceMs)).toBe(true)
      await sleep(pair.crossInstanceMs)
      expect(taskIds(got)).toEqual(['missed', 'live'])
    })

    it('does not replay events from before an ordinary (no `since`) subscribe', async () => {
      pair = impl.make()
      const user = uid('fresh')
      await pair.b.publish([user], ev('task_created', 'old'))
      await sleep(5)
      const { got } = await listen(pair.a, user)
      await sleep(pair.crossInstanceMs)
      expect(got).toEqual([])
    })

    it('delivers ephemeral events locally', async () => {
      pair = impl.make()
      const user = uid('ephemeral')
      const { got } = await listen(pair.a, user)
      await pair.a.publish([user], ev('agent_typing_start', 'T'), { persist: false })
      expect(taskIds(got)).toEqual(['T'])
    })

    it('stops delivering after unsubscribe', async () => {
      pair = impl.make()
      const user = uid('off')
      const { got, off } = await listen(pair.a, user)
      off()
      await pair.a.publish([user], ev('task_created', 'local'))
      await pair.b.publish([user], ev('task_created', 'remote'))
      await sleep(pair.crossInstanceMs)
      expect(got).toEqual([])
    })
  })
}

describe.runIf(Boolean(REDIS_URL))('redis bus latency (AWTD-1459 acceptance)', () => {
  it('p95 cross-instance delivery is under 1 s', async () => {
    const a = createRedisBus({ url: REDIS_URL })
    const b = createRedisBus({ url: REDIS_URL })
    try {
      const user = uid('p95')
      const latencies: number[] = []
      a.subscribe(user, e => latencies.push(Date.now() - e.ts))
      await sleep(150)
      for (let i = 0; i < 50; i++) {
        await b.publish([user], ev('task_updated', `p${i}`))
        await sleep(2)
      }
      expect(await waitFor(() => latencies.length === 50, 3_000)).toBe(true)
      latencies.sort((x, y) => x - y)
      expect(latencies[Math.ceil(0.95 * latencies.length) - 1]).toBeLessThan(1_000)
    } finally {
      await a.close()
      await b.close()
    }
  })
})

describe('upstash bus specifics (AWTD-1459)', () => {
  it('a publish to many users is one pipelined round trip', async () => {
    const store = new FakeUpstashStore()
    const bus = createUpstashBus({ client: createFakeUpstash(store), pollMs: 60_000 })
    await bus.publish(['u1', 'u2', 'u3'], ev('list_updated', 'P'))
    expect(store.roundTrips).toBe(1)
    expect(store.commands.filter(([c]) => c === 'zadd')).toHaveLength(3)
    await bus.close()
  })

  it('polls once per user per tick, however many connections that user has', async () => {
    const store = new FakeUpstashStore()
    const bus = createUpstashBus({ client: createFakeUpstash(store), pollMs: 30 })
    const offs = [1, 2, 3].map(() => bus.subscribe('multi-tab', () => {}))
    await sleep(100)
    const polls = store.commands.filter(([c]) => c === 'zrange').length
    expect(polls).toBeGreaterThan(0)
    expect(polls).toBeLessThanOrEqual(4)
    offs.forEach(off => off())
    await bus.close()
  })

  it('a failed poll does not advance the cursor: the event arrives on the next one', async () => {
    const store = new FakeUpstashStore()
    const a = createUpstashBus({ client: createFakeUpstash(store), pollMs: 30 })
    const b = createUpstashBus({ client: createFakeUpstash(store), pollMs: 60_000 })
    const got: RealtimeEnvelope[] = []
    a.subscribe('flaky', e => got.push(e))
    await b.publish(['flaky'], ev('task_updated', 'survives'))
    store.failNext = new Error('upstash 503')
    expect(await waitFor(() => got.length === 1, 500)).toBe(true)
    await a.close()
    await b.close()
  })

  it('without credentials it is local-only with an in-memory replay store (development)', async () => {
    const bus = createUpstashBus({ client: null })
    const user = uid('dev')
    const got: RealtimeEnvelope[] = []
    bus.subscribe(user, e => got.push(e))
    const before = Date.now() - 1
    await bus.publish([user], ev('task_created', 'D'))
    expect(taskIds(got)).toEqual(['D'])
    expect(taskIds(await bus.replaySince(user, before))).toEqual(['D'])
    await bus.close()
  })

  it('reads members written by the pre-bus sse-utils (same sorted set, same member shape)', async () => {
    const store = new FakeUpstashStore()
    const bus = createUpstashBus({ client: createFakeUpstash(store), pollMs: 60_000 })
    const ts = Date.now()
    store.zadd('sse:events:legacy', { score: ts, member: JSON.stringify({ event: ev('task_created', 'old-writer'), timestamp: ts, n: 'abc' }) })
    const replayed = await bus.replaySince('legacy', ts - 1)
    expect(replayed).toEqual([{ id: 'abc', ts, event: expect.objectContaining({ type: 'task_created' }) }])
    await bus.close()
  })
})

describe('REALTIME_BUS selection', () => {
  it('defaults to upstash, accepts redis, and refuses anything else', async () => {
    const { realtimeBusKind } = await import('@/lib/realtime/bus')
    expect(realtimeBusKind({})).toBe('upstash')
    expect(realtimeBusKind({ REALTIME_BUS: '' })).toBe('upstash')
    expect(realtimeBusKind({ REALTIME_BUS: ' Redis ' })).toBe('redis')
    expect(() => realtimeBusKind({ REALTIME_BUS: 'kafka' })).toThrow(/REALTIME_BUS/)
  })

  it('refuses to boot with REALTIME_BUS=redis and no REDIS_URL', async () => {
    const { assertRealtimeConfiguration } = await import('@/lib/realtime/bus')
    expect(() => assertRealtimeConfiguration({ REALTIME_BUS: 'redis' })).toThrow(/REDIS_URL/)
    expect(() => assertRealtimeConfiguration({ REALTIME_BUS: 'redis', REDIS_URL: 'redis://r:6379' })).not.toThrow()
    expect(() => assertRealtimeConfiguration({})).not.toThrow()
  })
})
