/**
 * Sliding-window renewal for mobile sessions (task 1e0eddcb).
 *
 * Web users never see the 30-day `maxAge` in lib/auth-config.ts, because
 * NextAuth's own session endpoint re-issues their token every `updateAge`
 * (default 24h) as they use the app. Mobile clients do not call that endpoint —
 * they call `/api/v1/auth/mobile-session`, which only ever validated. So a
 * mobile session died exactly 30 days after sign-in no matter how heavily the
 * app was used, and the user was bounced to the login screen.
 *
 * This module is the renewal decision and nothing else, so the route stays a
 * thin caller and the same logic can be exposed as an explicit
 * `/api/v1/auth/refresh` later without moving code.
 *
 * The rules it will not bend on, because this is auth:
 *   - an EXPIRED session is never renewed; renewal extends a live session
 *   - claims are preserved; only `iat` / `exp` / `jti` are reissued
 *   - the new window is the same 30 days the web policy uses
 */

import { encode } from 'next-auth/jwt'
import { randomUUID } from 'crypto'

/** Matches `session.maxAge` in lib/auth-config.ts. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/**
 * How stale a session must be before it is worth re-issuing. Matches NextAuth's
 * default `updateAge`, so mobile slides on the same cadence the web does —
 * without minting a new token on every app launch.
 */
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60

/**
 * Should a still-valid session be re-issued?
 *
 * `expSeconds` is the token's expiry. A session is worth renewing once more
 * than `updateAge` has elapsed since it was issued — equivalently, once its
 * remaining life has dropped below `maxAge - updateAge`.
 */
export function shouldRenewSession(
  expSeconds: number,
  nowSeconds: number,
  maxAge: number = SESSION_MAX_AGE_SECONDS,
  updateAge: number = SESSION_UPDATE_AGE_SECONDS,
): boolean {
  // Expired sessions are not renewable — that is a sign-in, not a refresh.
  if (expSeconds <= nowSeconds) return false

  const remaining = expSeconds - nowSeconds
  return remaining < maxAge - updateAge
}

/**
 * The claims a renewed token carries forward.
 *
 * `id` is required, not optional. A token that identifies nobody must never be
 * renewed, and requiring it here makes that a compile-time precondition rather
 * than a runtime hope — the route already refuses to call this without one.
 * It is also what NextAuth's augmented `JWT` type demands (types/next-auth.d.ts).
 */
export interface RenewableClaims extends Record<string, unknown> {
  id: string
}

/**
 * Mint a fresh token carrying the same identity, with a new 30-day window.
 *
 * Mirrors the shape the WebAuthn verify routes encode, so a renewed token is
 * indistinguishable from a freshly signed-in one to NextAuth's jwt callback.
 * Everything except the time-based claims is carried across verbatim, so a
 * claim added elsewhere does not silently vanish on renewal.
 */
export async function renewSessionToken(
  claims: RenewableClaims,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<{ token: string; expiresAt: Date }> {
  const exp = nowSeconds + SESSION_MAX_AGE_SECONDS

  // Drop the previous time-based claims so the fresh ones below win rather than
  // being overwritten by a spread of the old object.
  const { iat: _iat, exp: _exp, jti: _jti, ...carried } = claims

  const token = await encode({
    token: {
      ...carried,
      // Restated explicitly: the rest-spread above widens to an index
      // signature, which loses the `id` that NextAuth's JWT type requires.
      id: claims.id,
      iat: nowSeconds,
      exp,
      jti: randomUUID(),
    },
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
  })

  return { token, expiresAt: new Date(exp * 1000) }
}
