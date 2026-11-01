/**
 * RealtimeBus contract (AWTD-1459, PLATFORM_ASSESSMENT_2026-11 W2/A2, §5).
 *
 * One code path for realtime, with the transport picked by REALTIME_BUS:
 * `upstash` (astrid.cc on Vercel, the default) or `redis` (node-redis
 * pub/sub, for self-hosted and partner deployments). Both implementations are
 * held to the same assertions by tests/integration/realtime-bus-conformance.test.ts.
 *
 * Guarantees every implementation gives a subscriber:
 *   1. A publish on this instance reaches local subscribers synchronously,
 *      before `publish` resolves.
 *   2. A persisted publish on ANY instance reaches subscribers on every other
 *      instance — including one published a millisecond before a local
 *      delivery (the lastEventCheck race this interface exists to close).
 *   3. Each envelope reaches a given subscriber at most once.
 *   4. `replaySince` returns persisted envelopes newer than the timestamp, in
 *      order. Non-persisted (ephemeral) events are never replayed.
 */

/** The JSON object written as `data:` on the SSE wire: `{ type, timestamp, data }`. */
export type RealtimeEvent = { type: string; timestamp?: string; data?: unknown } & Record<string, unknown>

export interface RealtimeEnvelope {
  /** Unique per publish; the dedupe key. */
  id: string
  /** Publish time in ms since epoch, and the sorted-set score. */
  ts: number
  event: RealtimeEvent
}

export type RealtimeListener = (envelope: RealtimeEnvelope) => void

export interface PublishOptions {
  /**
   * Write to the shared replay store (default true). Ephemeral events —
   * pings, typing indicators — pass false: they are delivered live and never
   * replayed.
   */
  persist?: boolean
}

export interface SubscribeOptions {
  /** Replay persisted envelopes newer than this before live ones (reconnect recovery). */
  since?: number
  /**
   * The longest cross-instance delay this subscriber tolerates. Push
   * transports ignore it; the Upstash poll runs at the smallest value any
   * subscriber of that user asked for.
   */
  maxLatencyMs?: number
}

export type RealtimeBusKind = 'upstash' | 'redis'

export interface RealtimeBus {
  readonly kind: RealtimeBusKind
  publish(userIds: string[], event: RealtimeEvent, options?: PublishOptions): Promise<void>
  /** @returns unsubscribe */
  subscribe(userId: string, onEvent: RealtimeListener, options?: SubscribeOptions): () => void
  replaySince(userId: string, sinceMs: number): Promise<RealtimeEnvelope[]>
  /** Release timers and connections. Tests and graceful shutdown only. */
  close(): Promise<void>
}

// ── Shared storage format ───────────────────────────────────────────────────
// One sorted set per user, `sse:events:<userId>`, score = publish ms, member =
// JSON `{ event, timestamp, n }`. Unchanged from the pre-bus lib/sse-utils.ts,
// so old and new instances can share a store during a rolling deploy.

export const EVENT_TTL_SECONDS = 15 * 60

export const eventsKey = (userId: string) => `sse:events:${userId}`

export function encodeMember(envelope: RealtimeEnvelope): string {
  return JSON.stringify({ event: envelope.event, timestamp: envelope.ts, n: envelope.id })
}

/** Accepts the raw string or an already-deserialised object (Upstash auto-parses). */
export function decodeMember(raw: unknown): RealtimeEnvelope | null {
  let parsed: any = raw
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.timestamp !== 'number' || !parsed.event) return null
  const id = typeof parsed.n === 'string' ? parsed.n : `${parsed.timestamp}:${JSON.stringify(parsed.event)}`
  return { id, ts: parsed.timestamp, event: parsed.event }
}

export function newEnvelope(event: RealtimeEvent, now = Date.now()): RealtimeEnvelope {
  return { id: globalThis.crypto.randomUUID(), ts: now, event }
}
