/**
 * Drives the real SDK SSEClient (packages/astrid-sdk/src/channel/sse-client.ts)
 * with only the transport faked: `fetch` answers the OAuth token request and
 * serves each SSE connection from a queue of scripted stream bodies.
 *
 * Callers own the timer lifecycle: use fake timers so the client's reconnect
 * and keepalive timers never fire on their own.
 */
import { vi } from 'vitest'
import { OAuthClient } from '../../packages/astrid-sdk/src/channel/oauth-client'
import { SSEClient } from '../../packages/astrid-sdk/src/channel/sse-client'
import type { AgentSSEEvent, AstridChannelConfig } from '../../packages/astrid-sdk/src/channel/types'

const API_BASE = 'https://sdk-test.example/api/v1'

/** Event types the tests listen for. */
export const PROTOCOL_EVENT_TYPES = [
  'task.assigned',
  'task.updated',
  'task.completed',
  'task.deleted',
  'task.commented',
  'message',
  'connected',
  'custom_event',
] as const

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

/** One SSE frame as the server writes it. */
export function frame(data: unknown, opts: { event?: string; id?: string } = {}): string {
  let out = ''
  if (opts.id) out += `id: ${opts.id}\n`
  if (opts.event) out += `event: ${opts.event}\n`
  return `${out}data: ${JSON.stringify(data)}\n\n`
}

export function createSdkSseHarness() {
  const connections: string[][] = []
  const sseRequests: { url: string; headers: Record<string, string> }[] = []

  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    sseRequests.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const chunks = connections.shift()
    if (!chunks) throw new Error(`unexpected SSE connection to ${url}`)
    return sseResponse(chunks)
  })
  vi.stubGlobal('fetch', fetchMock)

  const config: AstridChannelConfig = {
    enabled: true,
    clientId: 'client-id',
    clientSecret: 'client-secret',
    apiBase: API_BASE,
  }
  const client = new SSEClient(config, new OAuthClient(config))

  const received: AgentSSEEvent[] = []
  for (const type of PROTOCOL_EVENT_TYPES) {
    client.on(type, event => received.push(event))
  }

  return {
    client,
    received,
    sseRequests,
    fetchMock,
    /** Open one SSE connection that streams `chunks` and then ends. */
    async connect(...chunks: string[]) {
      connections.push(chunks)
      await client.connect()
    },
  }
}
