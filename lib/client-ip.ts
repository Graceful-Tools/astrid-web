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
 * Cloudflare's published IPv4 edge ranges — https://www.cloudflare.com/ips-v4,
 * snapshot 2026-09-13. Cloudflare reaches Vercel over IPv4 (the apex has no
 * AAAA record), so the IPv6 list is not needed; an IPv6 peer is simply never
 * treated as Cloudflare. Re-check the URL if a proxied deployment starts keying
 * limits on 104.x/172.x addresses again — that means a new range was added.
 */
const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
]

/** Dotted-quad IPv4 → unsigned 32-bit integer, or null if it is not one. */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

const CLOUDFLARE_CIDRS = CLOUDFLARE_IPV4_RANGES.map((cidr) => {
  const [base, bits] = cidr.split('/')
  const prefix = Number(bits)
  // Mask as an unsigned value; `>>> 0` keeps the top bit from going negative.
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0)
  return { network: (ipv4ToInt(base)! & mask) >>> 0, mask }
})

/** True when `ip` is a Cloudflare edge address (IPv4 only, see above). */
export function isCloudflareIp(ip: string): boolean {
  const value = ipv4ToInt(ip)
  if (value === null) return false
  return CLOUDFLARE_CIDRS.some(({ network, mask }) => ((value & mask) >>> 0) === network)
}

/**
 * The peer our own infrastructure saw: the rightmost trusted X-Forwarded-For
 * hop, else X-Real-IP, else null.
 *
 * X-Forwarded-For reads `client, proxy1, proxy2, ...`, appended left to right,
 * so the LAST `depth` entries are the ones our own infrastructure wrote. The
 * first of those is the peer the outermost trusted proxy actually saw. Reading
 * the leftmost entry instead (the long-standing bug behind task c2fbe8e4) lets
 * any caller mint a fresh rate-limit bucket per request by sending their own
 * X-Forwarded-For.
 */
function trustedPeer(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for')

  if (forwarded) {
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean)
    if (hops.length > 0) {
      const index = Math.min(Math.max(hops.length - trustedProxyDepth(), 0), hops.length - 1)
      return hops[index]
    }
  }

  return request.headers.get('x-real-ip')?.trim() || null
}

/**
 * The client IP to key rate limits and abuse controls on.
 *
 * When the trusted peer is a Cloudflare edge, the request came through the
 * Cloudflare proxy in front of astrid.cc. Vercel overwrites X-Forwarded-For
 * with that edge address rather than appending, so the real client survives
 * only in `cf-connecting-ip`. That header is honoured ONLY when the peer is
 * verifiably Cloudflare: anyone can reach Vercel directly with a forged copy,
 * and trusting it there would hand back the rotate-a-bucket-per-request hole
 * that task c2fbe8e4 closed.
 */
export function getClientIp(request: NextRequest): string {
  const peer = trustedPeer(request)
  if (peer && isCloudflareIp(peer)) {
    const viaCloudflare = request.headers.get('cf-connecting-ip')?.trim()
    if (viaCloudflare) return viaCloudflare
  }
  return peer ?? 'unknown'
}

/** Namespaced rate-limit key for a request, e.g. `oauth:203.0.113.7`. */
export function clientIpKey(prefix: string, request: NextRequest): string {
  return `${prefix}:${getClientIp(request)}`
}
