/**
 * Desktop browser hand-off sign-in — the decisions, with no storage in sight.
 *
 * A native desktop app cannot host the NextAuth sign-in page, and should not
 * try: doing so would mean re-implementing passkeys, Google and Apple per
 * platform, and asking the user to type their password into a window that
 * could be anything. Instead the app opens the system browser at
 * `/signin/desktop`, the user signs in with whatever the web already supports,
 * and the browser hands a one-time code back through the app's registered URL
 * scheme.
 *
 * The threat that shapes every rule below: **any local program can register
 * the same URL scheme**, so the callback is not a private channel. PKCE is
 * what makes an intercepted code worthless — the app keeps a random verifier
 * to itself, sends only its SHA-256 hash when the flow starts, and must
 * produce the verifier to redeem. An interceptor has the code and not the
 * verifier.
 *
 * Two rules follow from that and are enforced here rather than left to the
 * routes:
 *   - **S256 only.** A `plain` challenge equals its verifier, so it travels in
 *     the same URL as the code and binds nothing.
 *   - **The redirect URI is never read from the request.** It is a constant per
 *     client. A flow that echoed a caller-supplied redirect would hand real
 *     codes to whoever asked.
 */

import { BRAND } from '@/lib/brand/config'

/**
 * How long a code stays redeemable. Short because the gap it covers is a
 * browser navigating to a URL scheme — a second or two — not a user reading a
 * consent screen, which has already happened by the time a code exists.
 */
export const DESKTOP_GRANT_TTL_SECONDS = 300

/** The only PKCE method this flow accepts. See the file header. */
export const DESKTOP_CODE_CHALLENGE_METHOD = 'S256'

/**
 * Cap on the opaque `state` the app round-trips. It is echoed into a URL and
 * never interpreted, so the cap exists to stop a caller from making the server
 * build an unbounded string, not to constrain the format.
 */
export const DESKTOP_STATE_MAX_LENGTH = 512

/** RFC 7636 §4.2 bounds. For S256 the challenge is always exactly 43. */
const CHALLENGE_MIN_LENGTH = 43
const CHALLENGE_MAX_LENGTH = 128
const BASE64URL = /^[A-Za-z0-9\-_]+$/

export type DesktopClientId = 'windows'

export interface DesktopClient {
  id: DesktopClientId
  /** Product name for the hand-off page — "Astrid for Windows". */
  name: string
  /**
   * Where a code is delivered. Fixed, not negotiated: this is the single
   * property that keeps the flow from being an open redirect.
   */
  redirectUri: string
}

function callbackUri(): string {
  return `${BRAND.appUrlScheme}://auth/callback`
}

const CLIENTS: Record<DesktopClientId, () => DesktopClient> = {
  windows: () => ({
    id: 'windows',
    name: `${BRAND.appName} for Windows`,
    redirectUri: callbackUri(),
  }),
}

/**
 * Resolve a client id from untrusted input.
 *
 * Returns null for anything not in the registry, so adding a platform is a
 * deliberate edit here rather than something a request can assert.
 */
export function desktopClientFor(raw: unknown): DesktopClient | null {
  if (typeof raw !== 'string') return null
  const build = CLIENTS[raw as DesktopClientId]
  return build ? build() : null
}

export interface DesktopGrantRequest {
  client: DesktopClient
  state: string
  codeChallenge: string
}

export type GrantValidation =
  | { ok: true; value: DesktopGrantRequest }
  | { ok: false; error: string }

/**
 * Validate what the browser passes on to `/api/auth/desktop/grant`.
 *
 * Note what is absent: no redirect URI, no scopes, no client secret. The
 * caller is already an authenticated web session, and the only thing being
 * decided is which local app receives the code.
 */
export function validateGrantRequest(input: unknown): GrantValidation {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, error: 'Invalid request body' }
  }
  const body = input as Record<string, unknown>

  const client = desktopClientFor(body.client)
  if (!client) return { ok: false, error: 'Unsupported client' }

  if (body.codeChallengeMethod !== DESKTOP_CODE_CHALLENGE_METHOD) {
    return { ok: false, error: 'Unsupported code challenge method' }
  }

  const { state, codeChallenge } = body
  if (typeof state !== 'string' || state.length === 0 || state.length > DESKTOP_STATE_MAX_LENGTH) {
    return { ok: false, error: 'Invalid state' }
  }

  if (
    typeof codeChallenge !== 'string' ||
    codeChallenge.length < CHALLENGE_MIN_LENGTH ||
    codeChallenge.length > CHALLENGE_MAX_LENGTH ||
    !BASE64URL.test(codeChallenge)
  ) {
    return { ok: false, error: 'Invalid code challenge' }
  }

  return { ok: true, value: { client, state, codeChallenge } }
}

/**
 * The URL the browser navigates to in order to wake the app.
 *
 * Both values go through `URLSearchParams`, so a `state` containing `&code=`
 * cannot smuggle a second code past the real one.
 */
export function buildDesktopCallbackUrl(
  client: DesktopClient,
  { code, state }: { code: string; state: string },
): string {
  const params = new URLSearchParams({ code, state })
  return `${client.redirectUri}?${params.toString()}`
}

export function grantExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + DESKTOP_GRANT_TTL_SECONDS * 1000)
}

/**
 * Whether a stored grant may still be redeemed.
 *
 * Expiry is exclusive at the boundary — a grant is dead the instant it reaches
 * `expiresAt` — and a used grant is never revived. The database enforces both
 * as well; this is the same rule stated where it can be read and tested.
 */
export function isGrantRedeemable(
  grant: { expiresAt: Date; usedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (grant.usedAt !== null) return false
  return grant.expiresAt.getTime() > now.getTime()
}

/** The two names NextAuth issues its session cookie under, by environment. */
export const SESSION_COOKIE_NAME_SECURE = '__Secure-next-auth.session-token'
export const SESSION_COOKIE_NAME_PLAIN = 'next-auth.session-token'

/**
 * Which name a client should store its session token under.
 *
 * Server-side this barely matters — every reader here accepts either name —
 * but a native client holds a whole `Cookie` header and has to pick one on
 * first sign-in, before it has ever seen a server cookie. Guessing wrong means
 * signing in successfully and then being treated as signed out, so the
 * exchange response states it rather than leaving the client to infer it from
 * the scheme of the URL it happened to be pointed at.
 *
 * Mirrors the `cookies` block in lib/auth-config.ts, which switches on
 * NODE_ENV === "production" and nothing else.
 */
export function sessionCookieNameFor(isProduction: boolean): string {
  return isProduction ? SESSION_COOKIE_NAME_SECURE : SESSION_COOKIE_NAME_PLAIN
}
