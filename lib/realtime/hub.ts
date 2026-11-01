/**
 * The in-process half of every RealtimeBus implementation (AWTD-1459).
 *
 * Holds this instance's listeners per user and is the ONE place that decides
 * whether an envelope reaches a listener. Each listener remembers the envelope
 * ids it has already been handed, so an event that arrives twice — once from a
 * local publish and again from the remote poll, pub/sub echo or a reconnect
 * replay — is written to the client once. That is load-bearing: the web
 * SSEManager only suppresses repeats inside 1 s and iOS does not dedupe at all.
 */

import type { RealtimeEnvelope, RealtimeListener } from './types'

export interface HubListener {
  readonly userId: string
  readonly onEvent: RealtimeListener
  /** Remote/replayed envelopes at or below this timestamp predate the listener. */
  readonly floor: number
  /** Optional upper bound on cross-instance delivery delay the listener asked for. */
  readonly maxLatencyMs?: number
  /** envelope id -> envelope ts, for dedupe. */
  readonly seen: Map<string, number>
  active: boolean
}

/** Prune a listener's seen-set only once it has grown past this many ids. */
const SEEN_PRUNE_THRESHOLD = 64

export class ListenerHub {
  private readonly users = new Map<string, Set<HubListener>>()

  /**
   * @param retainMs how long an id must be remembered after the newest envelope
   *   the listener has seen. Must cover every window in which the same envelope
   *   can be handed over again (the Upstash poll lookback, the redis catch-up).
   */
  constructor(private readonly retainMs: number) {}

  add(userId: string, onEvent: RealtimeListener, floor: number, maxLatencyMs?: number): { listener: HubListener; first: boolean } {
    let set = this.users.get(userId)
    const first = !set || set.size === 0
    if (!set) {
      set = new Set()
      this.users.set(userId, set)
    }
    const listener: HubListener = { userId, onEvent, floor, maxLatencyMs, seen: new Map(), active: true }
    set.add(listener)
    return { listener, first }
  }

  /** @returns true when the user has no listeners left on this instance. */
  remove(listener: HubListener): boolean {
    listener.active = false
    const set = this.users.get(listener.userId)
    if (!set) return true
    set.delete(listener)
    if (set.size === 0) {
      this.users.delete(listener.userId)
      return true
    }
    return false
  }

  listeners(userId: string): HubListener[] {
    return Array.from(this.users.get(userId) ?? [])
  }

  userIds(): string[] {
    return Array.from(this.users.keys())
  }

  /** A publish made on THIS instance: every current listener, no floor check. */
  deliverLocal(userId: string, envelope: RealtimeEnvelope): void {
    for (const listener of this.listeners(userId)) this.hand(listener, envelope)
  }

  /** An envelope from the shared store or another instance, to every listener. */
  deliverRemote(userId: string, envelope: RealtimeEnvelope): void {
    for (const listener of this.listeners(userId)) this.deliverRemoteTo(listener, envelope)
  }

  /** An envelope from the shared store, to one listener (a reconnect replay). */
  deliverRemoteTo(listener: HubListener, envelope: RealtimeEnvelope): void {
    if (envelope.ts <= listener.floor) return
    this.hand(listener, envelope)
  }

  private hand(listener: HubListener, envelope: RealtimeEnvelope): void {
    if (!listener.active || listener.seen.has(envelope.id)) return
    listener.seen.set(envelope.id, envelope.ts)
    this.prune(listener, envelope.ts)
    try {
      listener.onEvent(envelope)
    } catch {
      // A listener that throws is the caller's to tear down (sse-utils marks
      // the connection dead); it must not stop delivery to the others.
    }
  }

  private prune(listener: HubListener, newestTs: number): void {
    if (listener.seen.size <= SEEN_PRUNE_THRESHOLD) return
    const cutoff = newestTs - this.retainMs
    for (const [id, ts] of listener.seen) {
      if (ts < cutoff) listener.seen.delete(id)
    }
  }
}

// ── In-memory event store ───────────────────────────────────────────────────
// The replay source when there is no shared store (development) or the shared
// write failed. Process-local by definition; moved here from lib/sse-utils.ts.

const MEMORY_TTL_MS = 15 * 60 * 1000
const MEMORY_MAX_EVENTS_PER_USER = 50

declare global {
  var __realtimeMemoryEvents: Map<string, RealtimeEnvelope[]> | undefined
  var __realtimeMemorySweep: ReturnType<typeof setInterval> | undefined
}

export class MemoryEventStore {
  private readonly events: Map<string, RealtimeEnvelope[]>

  constructor() {
    this.events = globalThis.__realtimeMemoryEvents ?? new Map()
    globalThis.__realtimeMemoryEvents = this.events
    if (!globalThis.__realtimeMemorySweep) {
      const timer = setInterval(() => this.sweep(), 5 * 60 * 1000)
      ;(timer as { unref?: () => void }).unref?.()
      globalThis.__realtimeMemorySweep = timer
    }
  }

  add(userId: string, envelope: RealtimeEnvelope): void {
    let list = this.events.get(userId)
    if (!list) {
      list = []
      this.events.set(userId, list)
    }
    list.push(envelope)
    if (list.length > MEMORY_MAX_EVENTS_PER_USER) list.shift()
  }

  since(userId: string, sinceMs: number): RealtimeEnvelope[] {
    return (this.events.get(userId) ?? []).filter(e => e.ts > sinceMs)
  }

  sweep(now = Date.now()): void {
    const cutoff = now - MEMORY_TTL_MS
    this.events.forEach((list, userId) => {
      const kept = list.filter(e => e.ts > cutoff)
      if (kept.length === 0) this.events.delete(userId)
      else if (kept.length !== list.length) this.events.set(userId, kept)
    })
  }
}
