import type { NextRequest } from 'next/server'

/**
 * Number of proxy hops in front of this app whose X-Forwarded-For entries we
 * trust. Everything to the LEFT of them is client-supplied and forgeable.
 *
 * 1 is correct on Vercel, which overwrites X-Forwarded-For with the connecting
 * peer rather than appending to whatever the caller sent. A whitelabel
 * deployment behind an extra proxy (a CDN in front of a load balancer, say)
 * must raise this to match, or its rate limits are keyed on a value the
 * attacker chooses.
 */
const DEFAULT_TRUSTED_PROXY_DEPTH = 1

function trustedProxyDepth(): number {
  const raw = Number(process.env.TRUSTED_PROXY_DEPTH)
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_TRUSTED_PROXY_DEPTH
}

/**
 * The client IP to key rate limits and abuse controls on.
 *
 * X-Forwarded-For reads `client, proxy1, proxy2, ...`, appended left to right,
 * so the LAST `depth` entries are the ones our own infrastructure wrote. The
 * first of those is the peer the outermost trusted proxy actually saw — the
 * real client. Reading the leftmost entry instead (the long-standing bug behind
 * task c2fbe8e4) lets any caller mint a fresh rate-limit bucket per request by
 * sending their own X-Forwarded-For.
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')

  if (forwarded) {
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean)
    if (hops.length > 0) {
      const index = Math.min(Math.max(hops.length - trustedProxyDepth(), 0), hops.length - 1)
      return hops[index]
    }
  }

  return request.headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Namespaced rate-limit key for a request, e.g. `oauth:203.0.113.7`. */
export function clientIpKey(prefix: string, request: NextRequest): string {
  return `${prefix}:${getClientIp(request)}`
}
