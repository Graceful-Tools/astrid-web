/**
 * A connect grant parked across a sign-in (task 842601f2).
 *
 * ## Why the callback cannot just finish
 *
 * The browser-completed connect flow decides whose account gets the provider
 * token from the `state`, and the state names whoever STARTED the flow. An
 * attacker can start one for their own account and hand the victim the
 * provider's authorize URL; the victim approves, and their repo-scoped token is
 * filed on the attacker. `callbackSessionConflicts` catches that when the
 * victim's browser is signed in. When it is signed out, nothing does.
 *
 * ## What parking buys
 *
 * Instead of spending the grant on the account the state names, the callback
 * seals it into an HttpOnly cookie and sends the browser through sign-in. The
 * token is then filed on whoever signed in — the person actually sitting there.
 *
 * The attacker delivered the link, so they know the state; they do not have the
 * cookie, which was set on the response to the VICTIM's browser and is not
 * readable by script or by any other origin. So there is no version of this
 * where the attacker redeems it.
 *
 * ## Why the code, not the token
 *
 * We park the authorization code and exchange it only after sign-in. Exchanging
 * first would mean holding a live provider token with no owner decided yet.
 * Nothing here is a token, and the code is single-use at the provider.
 *
 * The seal is HMAC-signed so it cannot be forged, and the code inside is
 * encrypted so a cookie read off a device is not a usable grant. Fifteen
 * minutes: long enough to sign in, short enough that an abandoned link dies
 * before the provider's own code expiry.
 */

import crypto from 'crypto'

import { decryptField, encryptField } from '@/lib/field-encryption'
import type { OAuthStateProvider } from '@/lib/sync/oauth-state'

/** Cookie holding the sealed grant. Read only by the resume route. */
export const PENDING_LINK_COOKIE = 'astrid_pending_integration_link'

const TTL_MS = 15 * 60 * 1000

export interface PendingLink {
  provider: OAuthStateProvider
  code: string
  /** The redirect_uri the code was issued against, when the provider requires it echoed back. */
  redirectUri?: string
}

function sign(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export function sealPendingLink(link: PendingLink): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is required to seal a pending link')
  const body = JSON.stringify({
    provider: link.provider,
    code: encryptField(link.code),
    redirectUri: link.redirectUri,
    expires: Date.now() + TTL_MS,
  })
  const payload = Buffer.from(body).toString('base64url')
  return `${payload}.${sign(secret, payload)}`
}

/** @returns the parked grant, or null if it is not one this server sealed recently. */
export function openPendingLink(sealed: string): PendingLink | null {
  try {
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) return null
    const [payload, sig] = sealed.split('.')
    if (!payload || !sig) return null
    const expected = sign(secret, payload)
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null

    const body = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (Date.now() > Number(body.expires)) return null
    const code = decryptField(body.code)
    if (!code || !body.provider) return null

    return {
      provider: body.provider,
      code,
      ...(body.redirectUri ? { redirectUri: body.redirectUri } : {}),
    }
  } catch {
    return null
  }
}
