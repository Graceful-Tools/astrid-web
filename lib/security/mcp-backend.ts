import { Agent } from 'undici'
import { assertOutboundUrlShape, OutboundUrlError, resolvePublicOutboundUrl } from './outbound-url'

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

function parseBackend(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new OutboundUrlError('MCP backend must be a valid URL')
  }
  if (url.username || url.password || url.search || url.hash || raw.includes('?') || raw.includes('#')) {
    throw new OutboundUrlError('MCP backend must not contain credentials, query, or fragment')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new OutboundUrlError('MCP backend must use HTTP or HTTPS')
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`
  return url
}

function isConfiguredBackend(url: URL): boolean {
  const configured = process.env.ASTRID_API_BASE_URL
  return Boolean(configured && parseBackend(configured).href === url.href)
}

export function mcpBackendUrl(raw: string): URL {
  const url = parseBackend(raw)
  if (!isConfiguredBackend(url)) assertOutboundUrlShape(url.href)
  return url
}

/** Hosted overrides are public HTTPS; only an exact operator-set backend is trusted. */
export async function fetchMCPBackend(
  baseUrl: string,
  endpoint: string,
  init: RequestInit = {},
): Promise<Response> {
  const backend = mcpBackendUrl(baseUrl)
  if (!endpoint.startsWith('/') || endpoint.startsWith('//') || /[#\\]/.test(endpoint)) {
    throw new OutboundUrlError('Invalid MCP backend endpoint')
  }
  // Keep supported backend prefixes; never let URL resolution change the authority.
  const target = new URL(`${backend.href}${endpoint.slice(1)}`)
  if (target.origin !== backend.origin || !target.pathname.startsWith(backend.pathname)) {
    throw new OutboundUrlError('MCP endpoint escapes the configured backend')
  }
  const trusted = isConfiguredBackend(backend)
  const resolved = trusted ? null : await resolvePublicOutboundUrl(target.href)
  const dispatcher = new Agent(resolved ? {
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, resolved.address, resolved.family)
      },
    },
  } : {})
  try {
    const response = await fetch(target.href, {
      ...init,
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(30_000),
      dispatcher,
    } as RequestInit & { dispatcher: Agent })
    // Consume before closing the per-request pinned connection.
    let body: Uint8Array<ArrayBuffer> | null = null
    if (response.body) {
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_RESPONSE_BYTES) {
            await reader.cancel()
            throw new Error('MCP backend response exceeds 16 MiB')
          }
          chunks.push(value)
        }
      } finally {
        reader.releaseLock()
      }
      body = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        body.set(chunk, offset)
        offset += chunk.byteLength
      }
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  } finally {
    await dispatcher.close()
  }
}
