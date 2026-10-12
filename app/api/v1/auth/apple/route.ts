/**
 * POST /api/v1/auth/apple
 *
 * Apple Sign In for iOS. Verifies the identity token against Apple's JWKS;
 * linking and the session are lib/auth/native-sign-in.ts, shared with the
 * other native routes (AWTD-1104) — four copies of the linking rule had
 * drifted apart. Mirrors POST /api/auth/apple, plus the v1 `meta` envelope.
 */

import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from 'next/server'
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose'
import { resolveAppleIdentity, appleAllowedAudiences } from '@/lib/auth/apple-identity'
import { completeNativeSignIn } from '@/lib/auth/native-sign-in'
import { withRateLimitHandlerAsync, authRateLimiter } from '@/lib/rate-limiter'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.auth.apple')

const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys')
const appleJWKS = createRemoteJWKSet(APPLE_JWKS_URL)

interface AppleJWTPayload extends JWTPayload {
  sub: string
  email?: string
  email_verified?: string | boolean
  is_private_email?: string | boolean
  auth_time?: number
}

async function verifyAppleToken(identityToken: string): Promise<AppleJWTPayload> {
  const { payload } = await jwtVerify(identityToken, appleJWKS, {
    issuer: 'https://appleid.apple.com',
    audience: appleAllowedAudiences(),
  })
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error("Missing or invalid 'sub' claim")
  }
  return payload as AppleJWTPayload
}

async function appleSignInHandler(request: NextRequest) {
  // See the note in the v1 Google route: the brand switch must close this door
  // too, and before the body is read. (Task 3ba0719f.)
  const blocked = capabilityGate('authApple')
  if (blocked) return blocked

  try {
    const { identityToken, fullName } = await request.json()

    if (!identityToken) {
      return NextResponse.json({ error: 'Missing identity token' }, { status: 400 })
    }

    let verifiedPayload: AppleJWTPayload
    try {
      verifiedPayload = await verifyAppleToken(identityToken)
    } catch (error) {
      log.error({ err: error }, 'Apple token verification error')
      return NextResponse.json({ error: 'Invalid identity token' }, { status: 401 })
    }

    // Identity comes ONLY from the verified token. The body `email` was
    // previously trusted over the claim, which allowed account takeover:
    // an attacker's valid token + a victim's email linked the attacker's
    // Apple id onto the victim's account. Body email is display-only now
    // (and unused); body fullName is fine (Apple provides the name only
    // client-side on first auth).
    const { email, emailVerified } = resolveAppleIdentity(verifiedPayload)

    return await completeNativeSignIn({
      provider: 'apple',
      providerAccountId: verifiedPayload.sub,
      idToken: identityToken,
      email,
      emailTrust: emailVerified ? 'verified' : 'none',
      profile: { name: typeof fullName === 'string' && fullName ? fullName : null },
      meta: { apiVersion: 'v1' as const, authSource: 'apple' },
    })
  } catch (error) {
    log.error({ err: error }, 'Apple Sign In error')
    return NextResponse.json({ error: 'Apple Sign In failed' }, { status: 500 })
  }
}

export const POST = withRateLimitHandlerAsync(appleSignInHandler, authRateLimiter)
