/**
 * The base URL the OAuth discovery documents advertise.
 *
 * Both well-known routes built this by reflecting `x-forwarded-host` back into
 * `issuer`, `authorization_endpoint` and `token_endpoint`. That exists for a
 * real reason — preview deploys serve the same documents under their own
 * subdomain — but a client that discovers metadata through a host an attacker
 * can influence is then pointed at an attacker-controlled authorization
 * endpoint (task 866a4891).
 *
 * So the host is still honoured, but only when it is one this deployment
 * actually serves: the brand domain or a subdomain of it, which is exactly the
 * preview case. Anything else falls back to the configured base URL. The
 * boundary is the same one the NextAuth redirect callback uses, and the leading
 * dot is load-bearing there for the same reason: `endsWith(domain)` alone would
 * also accept `evil-astrid.cc`.
 */

import { headers } from 'next/headers'
import { getBaseUrl } from '@/lib/base-url'
import { isAstridSubdomainUrl } from '@/lib/auth-host'

export async function resolveDiscoveryBaseUrl(): Promise<string> {
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') || hdrs.get('host')
  const protocol = hdrs.get('x-forwarded-proto') || 'https'

  if (host) {
    const candidate = `${protocol}://${host}`
    if (isAstridSubdomainUrl(candidate)) {
      return candidate
    }
  }

  return getBaseUrl().replace(/\/$/, '')
}
