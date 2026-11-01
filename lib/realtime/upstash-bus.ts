/**
 * RealtimeBus over Upstash REST — astrid.cc's transport, and the default
 * (AWTD-1459). The only module besides lib/redis.ts allowed to import
 * `@upstash/redis` (eslint.config.mjs).
 *
 * Upstash REST has no SUBSCRIBE, so cross-instance delivery is a poll of the
 * user's sorted set. What changed from the pre-bus lib/sse-utils.ts:
 *
 *  - THE RACE. A local delivery used to set `lastEventCheck = Date.now()`, so an
 *    event another instance wrote just before fell below the next poll's lower
 *    bound and was lost. The cursor now moves ONLY after a successful poll, and
 *    only to the highest score the server returned; a local delivery never
 *    touches it. Each poll also reads LOOKBACK_MS behind the cursor, which
 *    covers a slow ZADD or a small clock difference between instances. Events
 *    seen twice are dropped by ListenerHub, per subscriber, by id.
 *  - One poll per USER per instance, not one per connection.
 *  - A publish is ONE pipelined round trip for all recipients, not three
 *    awaited calls per recipient.
 *
 * Without Upstash credentials (development) it degrades exactly as before:
 * local delivery plus an in-memory replay store, no cross-instance delivery.
 */

import { Redis } from '@upstash/redis'
import { createLogger } from '@/lib/logger'
import { ListenerHub, MemoryEventStore, type HubListener } from './hub'
import {
  EVENT_TTL_SECONDS,
  decodeMember,
  encodeMember,
  eventsKey,
  newEnvelope,
  type PublishOptions,
  type RealtimeBus,
  type RealtimeEnvelope,
  type RealtimeEvent,
  type RealtimeListener,
  type SubscribeOptions,
} from './types'

const log = createLogger('realtime-upstash')

/** The slice of the Upstash client this bus uses, so a test can hand in a fake. */
export interface UpstashPipelineLike {
  zadd(key: string, entry: { score: number; member: string }): UpstashPipelineLike
  zremrangebyscore(key: string, min: number, max: number): UpstashPipelineLike
  expire(key: string, seconds: number): UpstashPipelineLike
  exec(): Promise<unknown[]>
}
export interface UpstashLike {
  pipeline(): UpstashPipelineLike
  zrange(key: string, min: string | number, max: string | number, opts: { byScore: true }): Promise<unknown[]>
}

export interface UpstashBusOptions {
  /** `undefined` reads UPSTASH_REDIS_REST_URL/TOKEN; `null` forces memory mode. */
  client?: UpstashLike | null
  /** Poll interval when no subscriber asks for less. The SSE ping cadence. */
  pollMs?: number
  /** How far behind the cursor each poll reads. */
  lookbackMs?: number
}

export const DEFAULT_POLL_MS = 15_000
export const DEFAULT_LOOKBACK_MS = 30_000

function clientFromEnv(): UpstashLike | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token }) as unknown as UpstashLike
}

interface UserPoller {
  /** Highest score the server has returned for this user. Never moved by a local publish. */
  cursor: number
  intervalMs: number
  timer: ReturnType<typeof setInterval> | null
  inFlight: boolean
}

export function createUpstashBus(options: UpstashBusOptions = {}): RealtimeBus {
  const client = options.client === undefined ? clientFromEnv() : options.client
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const lookbackMs = options.lookbackMs ?? DEFAULT_LOOKBACK_MS
  const hub = new ListenerHub(lookbackMs + pollMs)
  const memory = new MemoryEventStore()
  const pollers = new Map<string, UserPoller>()

  async function poll(userId: string): Promise<void> {
    const poller = pollers.get(userId)
    if (!poller || poller.inFlight || !client) return
    poller.inFlight = true
    try {
      const members = await client.zrange(eventsKey(userId), poller.cursor - lookbackMs, '+inf', { byScore: true })
      const envelopes = members.map(decodeMember).filter((e): e is RealtimeEnvelope => e !== null)
      envelopes.sort((a, b) => a.ts - b.ts)
      let max = poller.cursor
      for (const envelope of envelopes) {
        hub.deliverRemote(userId, envelope)
        if (envelope.ts > max) max = envelope.ts
      }
      // Advance only now, after the server answered, and only to what it holds.
      if (pollers.get(userId) === poller) poller.cursor = max
    } catch (error) {
      // Cursor stays put: the next poll re-reads the same window.
      log.error({ err: error }, '[realtime] Upstash poll failed')
    } finally {
      poller.inFlight = false
    }
  }

  function desiredInterval(userId: string): number {
    let interval = pollMs
    for (const l of hub.listeners(userId)) {
      if (l.maxLatencyMs && l.maxLatencyMs > 0 && l.maxLatencyMs < interval) interval = l.maxLatencyMs
    }
    return interval
  }

  function schedule(userId: string): void {
    if (!client) return
    let poller = pollers.get(userId)
    if (!poller) {
      poller = { cursor: Date.now(), intervalMs: 0, timer: null, inFlight: false }
      pollers.set(userId, poller)
    }
    const interval = desiredInterval(userId)
    if (poller.timer && poller.intervalMs === interval) return
    if (poller.timer) clearInterval(poller.timer)
    poller.intervalMs = interval
    poller.timer = setInterval(() => { void poll(userId) }, interval)
  }

  function stop(userId: string): void {
    const poller = pollers.get(userId)
    if (poller?.timer) clearInterval(poller.timer)
    pollers.delete(userId)
  }

  async function replaySince(userId: string, sinceMs: number): Promise<RealtimeEnvelope[]> {
    if (client) {
      try {
        const members = await client.zrange(eventsKey(userId), `(${sinceMs}`, '+inf', { byScore: true })
        return members
          .map(decodeMember)
          .filter((e): e is RealtimeEnvelope => e !== null && e.ts > sinceMs)
          .sort((a, b) => a.ts - b.ts)
      } catch (error) {
        log.error({ err: error }, '[realtime] Upstash replay failed; using this instance\'s memory')
      }
    }
    return memory.since(userId, sinceMs)
  }

  return {
    kind: 'upstash',

    async publish(userIds: string[], event: RealtimeEvent, { persist = true }: PublishOptions = {}) {
      const envelope = newEnvelope(event)
      for (const userId of userIds) hub.deliverLocal(userId, envelope)
      if (!persist || userIds.length === 0) return

      if (!client) {
        for (const userId of userIds) memory.add(userId, envelope)
        return
      }
      try {
        const member = encodeMember(envelope)
        const pipeline = client.pipeline()
        for (const userId of userIds) {
          const key = eventsKey(userId)
          pipeline
            .zadd(key, { score: envelope.ts, member })
            .zremrangebyscore(key, 0, envelope.ts - EVENT_TTL_SECONDS * 1000)
            .expire(key, EVENT_TTL_SECONDS)
        }
        await pipeline.exec()
      } catch (error) {
        log.error({ err: error }, '[realtime] Upstash publish failed; kept in this instance\'s memory')
        for (const userId of userIds) memory.add(userId, envelope)
      }
    },

    subscribe(userId: string, onEvent: RealtimeListener, { since, maxLatencyMs }: SubscribeOptions = {}) {
      const floor = since ?? Date.now() - 1
      const { listener } = hub.add(userId, onEvent, floor, maxLatencyMs)
      schedule(userId)
      if (since !== undefined) replayInto(listener, since)
      return () => {
        if (!listener.active) return
        if (hub.remove(listener)) stop(userId)
        else schedule(userId)
      }
    },

    replaySince,

    async close() {
      for (const userId of Array.from(pollers.keys())) stop(userId)
    },
  }

  function replayInto(listener: HubListener, since: number): void {
    replaySince(listener.userId, since)
      .then(envelopes => envelopes.forEach(e => hub.deliverRemoteTo(listener, e)))
      .catch(error => log.error({ err: error }, '[realtime] replay failed'))
  }
}
