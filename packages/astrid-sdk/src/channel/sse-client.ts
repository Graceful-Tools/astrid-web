import type { OAuthClient } from './oauth-client.js'
import type { AstridChannelConfig, AgentSSEEvent } from './types.js'

type EventHandler = (event: AgentSSEEvent) => void

/**
 * SSE client using fetch + ReadableStream (supports Authorization headers).
 * Reconnects with exponential backoff. Keepalive timeout at 90s.
 */
export class SSEClient {
  private abortController: AbortController | null = null
  private connected = false
  private lastEventTime = Date.now()
  private reconnectAttempts = 0
  private handlers = new Map<string, EventHandler[]>()
  private keepaliveTimer: ReturnType<typeof setTimeout> | null = null
  private stopped = false

  constructor(
    private config: AstridChannelConfig,
    private oauth: OAuthClient
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
    this.stopped = false
    const token = await this.oauth.ensureToken()
    const base = this.config.sseEndpoint
      || `${this.config.apiBase || 'https://www.astrid.cc/api/v1'}/agent/events`
    const since = new Date(this.lastEventTime).toISOString()
    const url = `${base}?since=${encodeURIComponent(since)}`

    this.abortController = new AbortController()

    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      signal: this.abortController.signal,
    })

    if (res.status === 401) {
      await this.oauth.refreshToken()
      return this.connect()
    }

    if (!res.ok || !res.body) {
      throw new Error(`SSE connection failed: ${res.status}`)
    }

    this.connected = true
    this.reconnectAttempts = 0
    this.startKeepalive()

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const { events, remaining } = this.parseBuffer(buffer)
        buffer = remaining

        for (const event of events) {
          this.lastEventTime = Date.now()
          this.resetKeepalive()
          this.dispatch(event)
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return
      throw err
    } finally {
      this.connected = false
      this.stopKeepalive()
      if (!this.stopped) {
        this.scheduleReconnect()
      }
    }
  }

  disconnect(): void {
    this.stopped = true
    this.abortController?.abort()
    this.connected = false
    this.stopKeepalive()
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++
    const base = 2000
    const max = 120_000
    const delay = Math.min(base * Math.pow(1.4, this.reconnectAttempts), max)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1)
    setTimeout(() => {
      if (!this.stopped) this.connect().catch(console.error)
    }, Math.round(delay + jitter))
  }

  private parseBuffer(buffer: string): { events: AgentSSEEvent[]; remaining: string } {
    const events: AgentSSEEvent[] = []
    const lines = buffer.split('\n')
    let eventType = 'message'
    let dataLines: string[] = []
    let remaining = ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      if (i === lines.length - 1 && !buffer.endsWith('\n')) {
        remaining = line
        break
      }

      if (line === '') {
        if (dataLines.length > 0) {
          try {
            const data = JSON.parse(dataLines.join('\n'))
            events.push({ type: eventType, data })
          } catch { /* skip malformed */ }
        }
        eventType = 'message'
        dataLines = []
        continue
      }

      if (line.startsWith(':')) continue // comment / keepalive

      const colon = line.indexOf(':')
      if (colon === -1) continue
      const field = line.slice(0, colon)
      const value = line.slice(colon + 1).trimStart()

      if (field === 'event') eventType = value
      else if (field === 'data') dataLines.push(value)
    }

    return { events, remaining }
  }

  private dispatch(event: AgentSSEEvent): void {
    let type = event.type
    let data = event.data

    // Handle unnamed SSE events from broadcastToUsers / Redis polling.
    // These arrive as: data: {"type":"task_assigned","timestamp":"...","data":{...}}
    // Parsed as { type: 'message', data: { type: 'task_assigned', data: {...} } }
    // We need to map the internal type and unwrap the nested data.
    if (type === 'message' && data?.type) {
      type = this.mapEventType(data.type as string)
      data = data.data || data
    }

    const mapped: AgentSSEEvent = { type, data }
    const handlers = this.handlers.get(type) || []
    for (const handler of handlers) {
      try { handler(mapped) } catch (err) { console.error('SSE handler error:', err) }
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
