/**
 * The realtime bus: publish / subscribe / replaySince, transport chosen by
 * REALTIME_BUS (AWTD-1459). Everything that sends or streams realtime events —
 * broadcastToUsers, /api/sse, /api/v1/agent/events — goes through here.
 *
 *   REALTIME_BUS unset | upstash  → lib/realtime/upstash-bus.ts (astrid.cc)
 *   REALTIME_BUS=redis            → lib/realtime/redis-bus.ts  (needs REDIS_URL)
 *
 * The contract lives in ./types.ts. One code path, backend chosen by env, like
 * STORAGE_DRIVER (PLATFORM_ASSESSMENT_2026-11 §5).
 */

import { createRedisBus } from './redis-bus'
import type { RealtimeBus, RealtimeBusKind } from './types'
import { createUpstashBus } from './upstash-bus'

export type {
  PublishOptions,
  RealtimeBus,
  RealtimeBusKind,
  RealtimeEnvelope,
  RealtimeEvent,
  RealtimeListener,
  SubscribeOptions,
} from './types'

export const REALTIME_BUS_KINDS: readonly RealtimeBusKind[] = ['upstash', 'redis']

export function realtimeBusKind(env: Record<string, string | undefined> = process.env): RealtimeBusKind {
  const raw = env.REALTIME_BUS?.trim().toLowerCase()
  if (!raw) return 'upstash'
  if ((REALTIME_BUS_KINDS as readonly string[]).includes(raw)) return raw as RealtimeBusKind
  throw new Error(`REALTIME_BUS="${env.REALTIME_BUS}" is not one of ${REALTIME_BUS_KINDS.join(', ')}`)
}

/**
 * Called at server start (instrumentation.ts): an unknown REALTIME_BUS, or
 * `redis` without REDIS_URL, refuses to boot instead of silently falling back
 * to a transport that cannot reach the other replicas.
 */
export function assertRealtimeConfiguration(env: Record<string, string | undefined> = process.env): void {
  if (realtimeBusKind(env) === 'redis' && !env.REDIS_URL?.trim()) {
    throw new Error('REALTIME_BUS=redis is missing: REDIS_URL')
  }
}

declare global {
  var __realtimeBus: RealtimeBus | undefined
}

/** The process-wide bus (global so every route bundle shares one). */
export function getRealtimeBus(): RealtimeBus {
  if (!globalThis.__realtimeBus) {
    globalThis.__realtimeBus = realtimeBusKind({ REALTIME_BUS: process.env.REALTIME_BUS }) === 'redis' ? createRedisBus() : createUpstashBus()
  }
  return globalThis.__realtimeBus
}

/** Swap the process-wide bus (tests). Pass undefined to reset to env selection. */
export function setRealtimeBus(bus: RealtimeBus | undefined): void {
  globalThis.__realtimeBus = bus
}
