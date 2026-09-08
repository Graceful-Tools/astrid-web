/**
 * HMAC-signed `state` for the browser-completed integration connect flows
 * (task 842601f2).
 *
 * One implementation for GitHub Issues, Google Tasks and Copilot. It used to be
 * two: `lib/sync/github.ts` minted an untagged `userId.expires.sig` shared by
 * the GitHub and Google flows, while `lib/copilot/oauth.ts` kept its own copy
 * that prefixed the provider — its comment explaining that this "namespaces
 * state so it can't be replayed on another provider's callback". That
 * protection was right, and the flow it did NOT cover was the one where a
 * single mint produced a value two different callbacks would accept.
 *
 * ## What this does and does not defend
 *
 * The state proves the server minted it, for this provider, recently, for the
 * named user. It does NOT prove the browser presenting it belongs to that user
 * — the state names whoever STARTED the flow, and an attacker can start one for
 * their own account and hand the victim the provider's authorize URL. That is
 * the residual gap in 842601f2; `callbackSessionConflicts` narrows it when the
 * browser is signed in, and the app-completed flow (lib/sync/app-completed-link.ts)
 * removes it by keeping the code off the browser entirely. Provider tagging is
 * a separate, smaller property: it stops one minted state from being spent on a
 * callback it was never issued for.
 */

import crypto from 'crypto'

/** Connect flows that mint state. The tag is part of the signed payload. */
export type OAuthStateProvider = 'github' | 'google' | 'copilot'

const STATE_TTL_MS = 10 * 60 * 1000

function sign(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export function mintOAuthState(userId: string, provider: OAuthStateProvider): string {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('NEXTAUTH_SECRET is required to mint OAuth state')
  const expires = Date.now() + STATE_TTL_MS
  const payload = `${provider}.${userId}.${expires}`
  return Buffer.from(`${payload}.${sign(secret, payload)}`).toString('base64url')
}

/**
 * @returns the user id the state names, or null if it is not a state this
 * server minted for THIS provider within the TTL.
 *
 * A state minted before this shape landed carries no tag and so fails here.
 * Its TTL is ten minutes, so the only casualty is a connect started just before
 * a deploy, which surfaces as the existing "this connect link has expired" page
 * and is fixed by tapping Connect again.
 */
export function verifyOAuthState(state: string, provider: OAuthStateProvider): string | null {
  try {
    const secret = process.env.NEXTAUTH_SECRET
    if (!secret) return null
    const [tag, userId, expiresStr, sig] = Buffer.from(state, 'base64url').toString().split('.')
    if (tag !== provider || !userId || !expiresStr || !sig) return null
    if (Date.now() > Number(expiresStr)) return null
    const expected = sign(secret, `${provider}.${userId}.${expiresStr}`)
    // Equal-length hex on both sides; timingSafeEqual throws otherwise and the
    // catch below turns that into the same null a bad state gets.
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
    return userId
  } catch {
    return null
  }
}
