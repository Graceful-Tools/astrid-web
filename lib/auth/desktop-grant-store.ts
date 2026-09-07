/**
 * Storage for desktop hand-off codes.
 *
 * Deliberately its own table rather than a reuse of `OAuthAuthorizationCode`.
 * The two look alike — both are single-use PKCE codes — but they redeem into
 * very different things: an OAuth code becomes a scoped access token for a
 * third-party client, while one of these becomes a **full first-party
 * session**. Sharing a table would mean one lookup bug is enough to turn a
 * narrowly-scoped third-party code into an unrestricted session cookie. The
 * duplication is a few columns; the isolation is the point.
 *
 * The hashing, PKCE verification and lifetime rules are reused rather than
 * re-implemented, so the two paths cannot drift on the parts that must match.
 */

import { prisma } from '@/lib/prisma'
import { hashToken, verifyCodeChallenge } from '@/lib/oauth/oauth-token-manager'
import { randomBytes } from 'crypto'
import {
  DESKTOP_CODE_CHALLENGE_METHOD,
  grantExpiry,
  type DesktopClient,
} from '@/lib/auth/desktop-handoff'

/**
 * Prefix matches the convention the OAuth credentials use, so a leaked value
 * is identifiable on sight and the reuse checker's `astrid_` allowance covers
 * it. 32 bytes of base64url is 256 bits — the code is only alive for five
 * minutes, but it is the sole barrier in front of a session.
 */
const CODE_PREFIX = 'astrid_desktop_'
const CODE_BYTES = 32

export async function createDesktopGrant({
  userId,
  client,
  codeChallenge,
  now = new Date(),
}: {
  userId: string
  client: DesktopClient
  codeChallenge: string
  now?: Date
}): Promise<string> {
  const code = `${CODE_PREFIX}${randomBytes(CODE_BYTES).toString('base64url')}`

  await prisma.desktopAuthGrant.create({
    data: {
      code: hashToken(code),
      userId,
      client: client.id,
      codeChallenge,
      codeChallengeMethod: DESKTOP_CODE_CHALLENGE_METHOD,
      expiresAt: grantExpiry(now),
    },
  })

  return code
}

/**
 * Redeem a code, returning the user it was minted for.
 *
 * The claim is a conditional write, not a read followed by a write: `usedAt`
 * and `expiresAt` are in the WHERE clause, so exactly one of two racing
 * redemptions can come back with `count === 1`.
 *
 * Verification happens *after* the claim, which means a wrong verifier still
 * burns the code. That is the same call this repo made for WebAuthn challenges
 * (task 1a52195f) and it is right for the same reason: any local program can
 * register the app's URL scheme, so a verifier that does not match is evidence
 * the code went somewhere it should not have. Losing the flow costs the user
 * one click; leaving the code live lets whoever holds it keep trying.
 */
export interface DesktopGrantUser {
  id: string
  email: string | null
  name: string | null
  image: string | null
}

export type RedemptionResult =
  | { ok: true; user: DesktopGrantUser }
  /**
   * `invalid` covers a code that was wrong, already spent, expired, or
   * presented with the wrong verifier. They are one reason on purpose: telling
   * the caller which is which tells an interceptor which half it already holds.
   */
  | { ok: false; reason: 'invalid' | 'account-missing' }

export async function redeemDesktopGrant({
  code,
  client,
  codeVerifier,
  now = new Date(),
}: {
  code: string
  client: DesktopClient
  codeVerifier: string
  now?: Date
}): Promise<RedemptionResult> {
  const hashed = hashToken(code)

  const claimed = await prisma.desktopAuthGrant.updateMany({
    where: {
      code: hashed,
      client: client.id,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  })

  if (claimed.count !== 1) return { ok: false, reason: 'invalid' }

  const grant = await prisma.desktopAuthGrant.findUnique({ where: { code: hashed } })
  if (!grant) return { ok: false, reason: 'invalid' }

  if (!verifyCodeChallenge(codeVerifier, grant.codeChallenge, grant.codeChallengeMethod)) {
    return { ok: false, reason: 'invalid' }
  }

  // Resolved here rather than in the route: redemption is one decision, and
  // keeping the database access in this module is what lets the route stay a
  // thin caller (the rule tests/rules/prisma-in-routes-ratchet.test.ts holds).
  const user = await prisma.user.findUnique({
    where: { id: grant.userId },
    select: { id: true, email: true, name: true, image: true },
  })

  // The account can be deleted between the grant and the exchange. The foreign
  // key takes the grant with it, so this is belt and braces — but minting a
  // session for a user who no longer exists is not a failure worth leaving open.
  if (!user) return { ok: false, reason: 'account-missing' }

  return { ok: true, user }
}
