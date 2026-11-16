import { resolveApiBase } from './api-base.js'
import type { OAuthClient } from './oauth-client.js'
import type { AstridChannelConfig, AgentSSEEvent } from './types.js'

type EventHandler = (event: AgentSSEEvent) => void

interface RecoveryHooks {
  since: () => number
  onConnected: () => Promise<void>
  /**
   * Server time from a `connected` or `keepalive` event. A keepalive is
   * dispatched only after every event read before it was accepted, so it is
   * the one point at which a replay cursor may move.
   */
  onServerTime: (time: number, kind: 'connected' | 'keepalive') => void
}

/** A non-OK stream response; carries the server's Retry-After, if any. */
class SSEConnectError extends Error {
  constructor(readonly status: number, readonly retryAfterMs: number) {
    super(`SSE connection failed: ${status}`)
  }
}

/**
 * SSE client using fetch + ReadableStream (supports Authorization headers).
 * Reconnects with bounded exponential backoff and jitter (2 s doubling to a
 * 60 s cap, ±20%); the backoff resets only after a keepalive proves the
 * connection healthy, and a failed reconnect (including a 429) always
 * schedules the next one (AWTD-1565). Keepalive timeout at 90s.
 */
export class SSEClient {
  private abortController: AbortController | null = null
  private connected = false
  private lastEventTime = Date.now()
  private reconnectAttempts = 0
  private handlers = new Map<string, EventHandler[]>()
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // Fields of the event being read. They live on the instance, not in
  // parseBuffer, because a frame can be split across reads anywhere: the
  // `event:`/`id:` lines may arrive before a chunk boundary and the blank
  // line that ends the event after it (AWTD-1431).
  private pendingType = 'message'
  private pendingId: string | undefined
  private pendingData: string[] = []

  private static readonly MAX_AUTH_RETRIES = 3
  private static readonly AUTH_RETRY_BASE_MS = 1000
  private static readonly RECONNECT_BASE_MS = 2000
  private static readonly RECONNECT_MAX_MS = 60_000
  private static readonly RECONNECT_JITTER = 0.2

  // Instance-level dedup map — survives disconnect/reconnect cycles
  private deliveredEvents = new Map<string, number>()
  private static readonly DEDUP_TTL_MS = 5 * 60_000

  constructor(
    private config: AstridChannelConfig,
    private oauth: OAuthClient,
    private recovery?: RecoveryHooks
  ) {}

  on(eventType: string, handler: EventHandler): void {
    const list = this.handlers.get(eventType) || []
    list.push(handler)
    this.handlers.set(eventType, list)
  }

  isConnected(): boolean {
    return this.connected
  }

  async connect(): Promise<void> {
    return this.connectWithAuthRetry(0)
  }

  private async connectWithAuthRetry(authRetries: number): Promise<void> {
    this.stopped = false
    this.resetPending()
    const token = await this.oauth.ensureToken()
    const base = this.config.sseEndpoint
      || `${resolveApiBase(this.config.apiBase)}/agent/events`
    const since = new Date(this.recovery?.since() ?? this.lastEventTime).toISOString()
    const url = new URL(base)
    url.searchParams.set('since', since)

    this.abortController = new AbortController()

    const res = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      signal: this.abortController.signal,
    })

    if (res.status === 401) {
      if (authRetries >= SSEClient.MAX_AUTH_RETRIES) {
        throw new Error(`SSE connection failed: ${res.status} after ${authRetries} token refreshes`)
      }
      await this.oauth.refreshToken()
      await new Promise(resolve =>
        setTimeout(resolve, SSEClient.AUTH_RETRY_BASE_MS * 2 ** authRetries)
      )
      if (this.stopped) return
      return this.connectWithAuthRetry(authRetries + 1)
    }

    if (!res.ok || !res.body) {
      const retryAfter = Number(res.headers.get('Retry-After'))
      throw new SSEConnectError(res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0)
    }

    // Opening the stream is not success: a connection that is refused work,
    // or closes straight away, must keep backing off. See onHealthy().
    this.connected = true
    this.startKeepalive()

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      // The stream is already open and buffering while the queue is reconciled.
      await this.recovery?.onConnected()
      if (this.stopped) return
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Any data from the server (including keepalive comments) means
        // the connection is alive — reset the keepalive timer.
        this.resetKeepalive()

        buffer += decoder.decode(value, { stream: true })
        const { events, remaining } = this.parseBuffer(buffer)
        buffer = remaining

        for (const event of events) {
          if (!this.recovery) this.lastEventTime = Date.now()
          const dispatched = this.dispatch(event)
          if (this.recovery) await dispatched
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      throw err
    } finally {
      this.abortController?.abort()
      this.connected = false
      this.stopKeepalive()
      if (!this.stopped) {
        this.scheduleReconnect()
      }
    }
  }

  disconnect(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.abortController?.abort()
    this.connected = false
    this.stopKeepalive()
  }

  private eventFingerprint(type: string, data: any): string {
    const taskId = data?.taskId || ''
    const commentId = data?.comment?.id || data?.commentId || ''
    return `${type}:${taskId}:${commentId}`
  }

  private isDuplicate(fp: string): boolean {
    const now = Date.now()
    // Prune expired entries periodically
    if (this.deliveredEvents.size > 100) {
      for (const [key, ts] of this.deliveredEvents) {
        if (now - ts > SSEClient.DEDUP_TTL_MS) this.deliveredEvents.delete(key)
      }
    }
    if (this.deliveredEvents.has(fp)) {
      const age = now - this.deliveredEvents.get(fp)!
      if (age < SSEClient.DEDUP_TTL_MS) return true
    }
    this.deliveredEvents.set(fp, now)
    return false
  }

  /**
   * One pending reconnect at a time. A reconnect that fails before its stream
   * opens (network, token, 401 exhaustion, 429, 5xx) schedules the next one
   * itself; a failure after the stream opened was already rescheduled by the
   * read loop's `finally`, which the single-timer guard absorbs.
   */
  private scheduleReconnect(minDelayMs = 0): void {
    if (this.stopped || this.reconnectTimer) return
    this.reconnectAttempts++
    const exponential = SSEClient.RECONNECT_BASE_MS * 2 ** (this.reconnectAttempts - 1)
    const backoff = Math.min(exponential, SSEClient.RECONNECT_MAX_MS)
    const jittered = backoff * (1 + SSEClient.RECONNECT_JITTER * (Math.random() * 2 - 1))
    const delay = Math.round(Math.min(Math.max(jittered, minDelayMs), SSEClient.RECONNECT_MAX_MS))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.stopped) return
      this.connect().catch(err => {
        console.error('Astrid SSE: reconnect failed:', err)
        this.scheduleReconnect(err instanceof SSEConnectError ? err.retryAfterMs : 0)
      })
    }, delay)
  }

  /** A keepalive was dispatched: everything before it was handled. */
  private onHealthy(): void {
    this.reconnectAttempts = 0
  }

  private resetPending(): void {
    this.pendingType = 'message'
    this.pendingId = undefined
    this.pendingData = []
  }

  private parseBuffer(buffer: string): { events: AgentSSEEvent[]; remaining: string } {
    const events: AgentSSEEvent[] = []
    const lines = buffer.split('\n')
    // The last element is an unfinished line, or '' when the buffer ends in \n.
    const remaining = lines.pop() ?? ''

    for (const line of lines) {
      if (line === '') {
        if (this.pendingData.length > 0) {
          try {
            const data = JSON.parse(this.pendingData.join('\n'))
            const event: AgentSSEEvent = { type: this.pendingType, data }
            if (this.pendingId) event.id = this.pendingId
            events.push(event)
          } catch { /* skip malformed */ }
        }
        this.resetPending()
        continue
      }

      if (line.startsWith(':')) continue // comment / keepalive

      const colon = line.indexOf(':')
      if (colon === -1) continue
      const field = line.slice(0, colon)
      const value = line.slice(colon + 1).trimStart()

      if (field === 'event') this.pendingType = value
      else if (field === 'data') this.pendingData.push(value)
      else if (field === 'id') this.pendingId = value
    }

    return { events, remaining }
  }

  private async dispatch(event: AgentSSEEvent): Promise<void> {
    let type = event.type
    let data = event.data

    // Handle unnamed SSE events from broadcastToUsers / Redis polling.
    // These arrive as: data: {"type":"task_assigned","timestamp":"...","data":{...}}
    // Parsed as { type: 'message', data: { type: 'task_assigned', data: {...} } }
    // We need to map the internal type and unwrap the nested data.
    if (type === 'message' && data?.type) {
      type = this.mapEventType(data.type as string)
      data = (data.data || data) as AgentSSEEvent['data']
    }

    if (this.recovery && (type === 'connected' || type === 'keepalive')) {
      const raw = data.serverTime ?? data.timestamp
      const time = typeof raw === 'string' ? Date.parse(raw) : NaN
      if (Number.isFinite(time) && time >= 0) this.recovery.onServerTime(time, type)
      else console.warn('Astrid recovery: stream has no valid server time; replay cursor unchanged')
    }
    if (type === 'keepalive') this.onHealthy()

    // Recovery deliveries use persisted receipts; terminal repeats are idempotent.
    const fp = this.eventFingerprint(type, data)
    const ledgerEvent = ['task.assigned', 'task.commented', 'task.completed', 'task.deleted'].includes(type)
    if (!(this.recovery && ledgerEvent) && this.isDuplicate(fp)) return

    const mapped: AgentSSEEvent = { type, data }
    if (event.id) mapped.id = event.id
    const handlers = this.handlers.get(type) || []
    for (const handler of handlers) {
      try {
        const handled = handler(mapped)
        if (this.recovery) await handled
        else void Promise.resolve(handled).catch(err => console.error('SSE handler error:', err))
      } catch (err) {
        if (this.recovery) throw err
        console.error('SSE handler error:', err)
      }
    }
  }

  /** Map internal server event types to agent protocol event names */
  private mapEventType(type: string): string {
    switch (type) {
      case 'task_assigned':
      case 'task_created':
        return 'task.assigned'
      case 'task_updated':
        return 'task.updated'
      case 'task_completed':
        return 'task.completed'
      case 'task_deleted':
        return 'task.deleted'
      case 'comment_created':
      case 'comment_added':
      case 'agent_task_comment':
        return 'task.commented'
      default:
        return type
    }
  }

  private startKeepalive(): void {
    this.keepaliveTimer = setTimeout(() => {
      console.warn('Astrid SSE: keepalive timeout, reconnecting...')
      this.abortController?.abort()
    }, 90_000)
  }

  private resetKeepalive(): void {
    this.stopKeepalive()
    this.startKeepalive()
  }

  private stopKeepalive(): void {
    if (this.keepaliveTimer) {
      clearTimeout(this.keepaliveTimer)
      this.keepaliveTimer = null
    }
  }
}
