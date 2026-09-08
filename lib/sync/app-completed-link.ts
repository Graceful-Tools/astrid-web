/**
 * The app-completed integration link (task 842601f2).
 *
 * ## Why this exists
 *
 * The browser-completed flow mints an HMAC `state` carrying the initiator's
 * user id, and the callback files the provider token on whoever that state
 * names. An attacker can call /authorize for their own account, take the
 * state, and send the victim the provider's authorize URL carrying it. The
 * victim approves at GitHub or Google, and their repo-scoped token lands on the
 * ATTACKER's account, usable through /api/v1/sync/github/*.
 *
 * `callbackSessionConflicts` answers "who is actually sitting here" from the
 * browser session, but only when there IS one. The native flow has none by
 * construction: the app calls /authorize with its own OAuth token and then
 * opens a system browser that carries no cookie of ours.
 *
 * ## What the app-completed flow changes
 *
 * The provider redirects the code to the APP, via the brand's custom URL
 * scheme, on the user's own device. The app then posts that code here
 * authenticated as itself. There is no state and no browser in the trust path:
 * the token is filed on whoever holds the credential that made the call.
 *
 * An attacker who mints their own link gains nothing, because the code is
 * delivered to the approving user's app, not to a server endpoint the attacker
 * can drain.
 *
 * ## Scheme check
 *
 * A redirect URI that is not this brand's app scheme means the code did not go
 * straight to the app — it travelled through a browser or somebody else's
 * server first, which is exactly the property this flow buys. Refuse it rather
 * than exchange it.
 */

import crypto from 'crypto'

import { BRAND } from '@/lib/brand/config'

/** The app-scheme redirect URIs this deployment will exchange a code against. */
export function isAppSchemeRedirect(redirectUri: unknown): redirectUri is string {
  if (typeof redirectUri !== 'string' || !redirectUri) return false
  const scheme = BRAND.appUrlScheme
  if (!scheme) return false
  // Compare the scheme only. The path is the app's business, but it must not
  // be able to smuggle a different scheme past a naive prefix match.
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//.exec(redirectUri)
  return match?.[1].toLowerCase() === scheme.toLowerCase()
}

/**
 * State for an app-completed link.
 *
 * It carries no user identity on purpose. The browser flow's state IS the
 * authority — which is the whole vulnerability — whereas here authority comes
 * from the OAuth credential on the /complete call. This value exists only so
 * the app can check the provider round-tripped the request it started, which
 * is a client-side concern, so the server never needs to verify it.
 */
export function appCompletedState(): string {
  return crypto.randomBytes(16).toString('base64url')
}
