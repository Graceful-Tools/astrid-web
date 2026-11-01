/**
 * RealtimeBus over a plain Redis server with node-redis (AWTD-1459, finding A2).
 * REALTIME_BUS=redis; the transport for self-hosted and partner deployments,
 * which have a Redis but no Upstash.
 *
 * Live delivery is PUBLISH/SUBSCRIBE on one channel per user, so a write on any
 * replica reaches every other replica's connections immediately rather than on
 * the next 15 s poll. The same per-user sorted set the Upstash bus uses is kept
 * for replay: a client reconnecting with `since`, and this instance's own
 * catch-up after it (re)subscribes — a publish that lands between a listener
 * registering and SUBSCRIBE being acknowledged would otherwise be missed.
 */

import { createClient } from 'redis'
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

const log = createLogger('realtime-redis')

type NodeRedis = ReturnType<typeof createClient>

export const channelFor = (userId: string) => `sse:user:${userId}`
const userFromChannel = (channel: string) => channel.slice('sse:user:'.length)

export interface RedisBusOptions {
  /** Defaults to REDIS_URL. */
  url?: string
  /** How far behind the newest delivered event a reconnect catch-up reads. */
  catchUpMs?: number
}

export function createRedisBus(options: RedisBusOptions = {}): RealtimeBus {
  const url = options.url ?? process.env.REDIS_URL
  if (!url) throw new Error('REALTIME_BUS=redis needs REDIS_URL')
  const catchUpMs = options.catchUpMs ?? 30_000
  const hub = new ListenerHub(catchUpMs * 2)
  const memory = new MemoryEventStore()
  /** Newest envelope ts delivered per user, the reconnect catch-up's anchor. */
  const newest = new Map<string, number>()
  const subscribed = new Map<string, Promise<void>>()

  const publisher: NodeRedis = createClient({ url })
  const subscriber: NodeRedis = publisher.duplicate()
  publisher.on('error', err => log.error({ err }, '[realtime] redis publisher error'))
  subscriber.on('error', err => log.error({ err }, '[realtime] redis subscriber error'))

  let readyOnce = false
  subscriber.on('ready', () => {
    // node-redis resubscribes by itself after a reconnect; what it cannot do is
    // recover what was published while the socket was down.
    if (readyOnce) for (const userId of hub.userIds()) catchUp(userId)
    readyOnce = true
  })

  let publisherReady: Promise<unknown> | null = null
  let subscriberReady: Promise<unknown> | null = null
  const connect = (client: NodeRedis, current: Promise<unknown> | null, set: (p: Promise<unknown> | null) => void) => {
    if (client.isOpen) return Promise.resolve()
    if (current) return current
    const p = client.connect().catch(error => {
      set(null)
      throw error
    })
    set(p)
    return p
  }
  const pub = () => connect(publisher, publisherReady, p => { publisherReady = p })
  const sub = () => connect(subscriber, subscriberReady, p => { subscriberReady = p })

  function onMessage(message: string, channel: string) {
    const envelope = decodeMember(message)
    if (!envelope) return
    const userId = userFromChannel(channel)
    newest.set(userId, Math.max(newest.get(userId) ?? 0, envelope.ts))
    hub.deliverRemote(userId, envelope)
  }

  function ensureSubscribed(userId: string): Promise<void> {
    let ready = subscribed.get(userId)
    if (!ready) {
      ready = sub()
        .then(() => subscriber.subscribe(channelFor(userId), onMessage))
        .catch(error => {
          subscribed.delete(userId)
          log.error({ err: error }, '[realtime] redis subscribe failed')
        })
      subscribed.set(userId, ready)
    }
    return ready
  }

  async function replaySince(userId: string, sinceMs: number): Promise<RealtimeEnvelope[]> {
    try {
      await pub()
      const members = await publisher.zRange(eventsKey(userId), `(${sinceMs}`, '+inf', { BY: 'SCORE' })
      return members
        .map(decodeMember)
        .filter((e): e is RealtimeEnvelope => e !== null && e.ts > sinceMs)
        .sort((a, b) => a.ts - b.ts)
    } catch (error) {
      log.error({ err: error }, '[realtime] redis replay failed; using this instance\'s memory')
      return memory.since(userId, sinceMs)
    }
  }

  function replayInto(listeners: HubListener[], userId: string, since: number) {
    replaySince(userId, since)
      .then(envelopes => {
        for (const envelope of envelopes) {
          for (const l of listeners) hub.deliverRemoteTo(l, envelope)
        }
      })
      .catch(error => log.error({ err: error }, '[realtime] catch-up failed'))
  }

  function catchUp(userId: string) {
    const listeners = hub.listeners(userId)
    if (listeners.length === 0) return
    const anchor = newest.get(userId) ?? Math.min(...listeners.map(l => l.floor))
    replayInto(listeners, userId, anchor - catchUpMs)
  }

  return {
    kind: 'redis',

    async publish(userIds: string[], event: RealtimeEvent, { persist = true }: PublishOptions = {}) {
      const envelope = newEnvelope(event)
      for (const userId of userIds) hub.deliverLocal(userId, envelope)
      if (userIds.length === 0) return
      const member = encodeMember(envelope)
      try {
        await pub()
        const multi = publisher.multi()
        for (const userId of userIds) {
          if (persist) {
            const key = eventsKey(userId)
            multi
              .zAdd(key, { score: envelope.ts, value: member })
              .zRemRangeByScore(key, 0, envelope.ts - EVENT_TTL_SECONDS * 1000)
              .expire(key, EVENT_TTL_SECONDS)
          }
          multi.publish(channelFor(userId), member)
        }
        await multi.execAsPipeline()
      } catch (error) {
        log.error({ err: error }, '[realtime] redis publish failed; kept in this instance\'s memory')
        if (persist) for (const userId of userIds) memory.add(userId, envelope)
      }
    },

    subscribe(userId: string, onEvent: RealtimeListener, { since, maxLatencyMs }: SubscribeOptions = {}) {
      const floor = since ?? Date.now() - 1
      const { listener } = hub.add(userId, onEvent, floor, maxLatencyMs)
      // Catch up from the floor once SUBSCRIBE is acknowledged: covers both a
      // `since` reconnect and anything published during the subscribe round trip.
      void ensureSubscribed(userId).then(() => {
        if (listener.active) replayInto([listener], userId, floor)
      })
      return () => {
        if (!listener.active) return
        if (hub.remove(listener)) {
          subscribed.delete(userId)
          newest.delete(userId)
          if (subscriber.isOpen) {
            subscriber.unsubscribe(channelFor(userId)).catch(error => log.warn({ err: error }, '[realtime] redis unsubscribe failed'))
          }
        }
      }
    },

    replaySince,

    async close() {
      await Promise.allSettled([
        subscriber.isOpen ? subscriber.quit() : Promise.resolve(),
        publisher.isOpen ? publisher.quit() : Promise.resolve(),
      ])
    },
  }
}
