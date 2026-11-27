import { Agent, fetch as undiciFetch } from 'undici'
import { nextAuthOrigin } from '../brand/config'
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
  // The operator's own settings: the explicit backend, else this deployment's origin
  // (what mcpHostedBaseUrl falls back to, ADEV-99).
  const configured = [process.env.ASTRID_API_BASE_URL, nextAuthOrigin()]
  return configured.some(value => Boolean(value && parseBackend(value).href === url.href))
}

export function mcpBackendUrl(raw: string): URL {
  const url = parseBackend(raw)
  if (!isConfiguredBackend(url)) assertOutboundUrlShape(url.href)
  return url
}

let sharedPool: Agent | null = null

/**
 * One pool per process for hops to the configured backend, reused across requests.
 * undici's default 4 s idle timeout: an agent's back-to-back calls reuse the socket, and a
 * socket left idle across a suspended serverless instance is not kept long enough to go stale.
 */
function trustedBackendPool(): Agent {
  sharedPool ??= new Agent()
  return sharedPool
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
  if (init.body != null && typeof init.body !== 'string') {
    throw new TypeError('MCP backend requests require a serialized JSON body')
  }
  const resolved = trusted ? null : await resolvePublicOutboundUrl(target.href)
  // The operator's own backend shares one keep-alive pool (ADEV-314: a fresh TCP+TLS
  // connection was a third of every hop). An override keeps its own connection, pinned
  // to the address it was vetted at, and closes it after.
  const dispatcher = resolved ? new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        if (options.all) {
          callback(null, [{ address: resolved.address, family: resolved.family }])
        } else {
          callback(null, resolved.address, resolved.family)
        }
      },
    },
  }) : trustedBackendPool()
  try {
    const response = await undiciFetch(target.href, {
      method: init.method,
      headers: init.headers ? Object.fromEntries(new Headers(init.headers)) : undefined,
      body: init.body,
      redirect: 'error',
      signal: init.signal ?? AbortSignal.timeout(30_000),
      dispatcher,
    })
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
      headers: Object.fromEntries(response.headers),
    })
  } finally {
    if (resolved) await dispatcher.close()
  }
}
