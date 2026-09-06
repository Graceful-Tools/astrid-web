/**
 * Whether a user-supplied URL is safe for this server to call.
 *
 * The webhook settings routes accepted any `z.string().url()` and then fetched
 * it, returning the status code and response time to the caller — a working
 * internal port scanner and cloud-metadata probe (task 3794f4ce). The same
 * stored URL is then used for every real delivery, so it was also a persistent,
 * event-triggered request forgery carrying task content.
 *
 * lib/security/remote-image.ts already got this right for images, but its
 * policy is an explicit host allow-list, which cannot work for webhooks: the
 * whole point is that users name their own servers. So the rule here is
 * "anywhere on the public internet, and nowhere else", and the address checks
 * are shared with the image path rather than written twice.
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class OutboundUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutboundUrlError'
  }
}

export function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return true
  const [a, b] = parts

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  )
}

export function isBlockedIp(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isBlockedIpv4(address)
  if (version !== 6) return true

  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) {
    return isBlockedIpv4(normalized.slice('::ffff:'.length))
  }

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8')
  )
}

/** Shape checks that need no network: protocol, credentials, literal addresses. */
export function assertOutboundUrlShape(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new OutboundUrlError('Must be a valid URL')
  }

  if (url.protocol !== 'https:') {
    throw new OutboundUrlError('Must be an https:// URL')
  }
  if (url.username || url.password) {
    throw new OutboundUrlError('URL must not contain credentials')
  }
  // A literal address skips DNS entirely, so check it here too.
  const literal = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal) && isBlockedIp(literal)) {
    throw new OutboundUrlError('URL points at a private or reserved address')
  }
  return url
}

/**
 * Full check, including DNS. Call this at save time AND before each delivery:
 * a name that resolved publicly yesterday can resolve to 127.0.0.1 today, so
 * validating only on save is a rebinding hole rather than a defence.
 */
export async function assertPublicOutboundUrl(raw: string): Promise<URL> {
  const url = assertOutboundUrlShape(raw)

  const literal = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(literal)) return url

  let addresses
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true })
  } catch {
    throw new OutboundUrlError('Host could not be resolved')
  }
  if (addresses.length === 0 || addresses.some(result => isBlockedIp(result.address))) {
    throw new OutboundUrlError('Host resolves to a private or reserved address')
  }
  return url
}
