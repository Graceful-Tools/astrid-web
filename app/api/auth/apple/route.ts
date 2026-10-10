import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from "next/server"
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose"
import { resolveAppleIdentity, appleAllowedAudiences } from "@/lib/auth/apple-identity"
import { completeNativeSignIn } from '@/lib/auth/native-sign-in'
import { withRateLimitHandlerAsync, authRateLimiter } from "@/lib/rate-limiter"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.apple')


// Apple's JWKS endpoint for public keys
const APPLE_JWKS_URL = new URL("https://appleid.apple.com/auth/keys")

// Cache the JWKS for performance (jose handles caching internally)
const appleJWKS = createRemoteJWKSet(APPLE_JWKS_URL)

interface AppleJWTPayload extends JWTPayload {
  sub: string      // Apple user ID
  email?: string   // User's email (may not be present on subsequent logins)
  email_verified?: string | boolean
  is_private_email?: string | boolean
  auth_time?: number
}

/**
 * Verify Apple identity token with Apple's public keys
 * Validates signature, issuer, audience, and expiration
 */
async function verifyAppleToken(identityToken: string): Promise<AppleJWTPayload> {
  try {
    const { payload } = await jwtVerify(identityToken, appleJWKS, {
      issuer: "https://appleid.apple.com",
      audience: appleAllowedAudiences(),
    })

    // Validate required claims
    if (!payload.sub || typeof payload.sub !== "string") {
      throw new Error("Missing or invalid 'sub' claim")
    }

    return payload as AppleJWTPayload
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Apple token verification failed: ${error.message}`)
    }
    throw new Error("Apple token verification failed")
  }
}

// Apple Sign In endpoint for iOS
async function appleSignInHandler(request: NextRequest) {
  const blocked = capabilityGate('authApple')
  if (blocked) return blocked

  try {
    const { identityToken, fullName } = await request.json()

    if (!identityToken) {
      return NextResponse.json({ error: "Missing identity token" }, { status: 400 })
    }

    // Verify the identity token with Apple's public keys
    let verifiedPayload: AppleJWTPayload
    try {
      verifiedPayload = await verifyAppleToken(identityToken)
    } catch (error) {
      log.error({ err: error }, "Apple token verification error:")
      return NextResponse.json({ error: "Invalid identity token" }, { status: 401 })
    }

    // Identity comes ONLY from the verified token — the body email was
    // previously trusted over the claim (account-takeover vector). See
    // lib/auth/apple-identity.ts for the contract.
    const { email, emailVerified } = resolveAppleIdentity(verifiedPayload)

    // Find-or-link-or-create and the session are shared with the other native
    // routes (AWTD-1104): lib/auth/native-sign-in.ts. The Apple account row is
    // looked up first, so a returning user signs in without the email claim.
    return await completeNativeSignIn({
      provider: 'apple',
      providerAccountId: verifiedPayload.sub,
      idToken: identityToken,
      email,
      emailTrust: emailVerified ? 'verified' : 'none',
      profile: { name: typeof fullName === 'string' && fullName ? fullName : null },
    })

  } catch (error) {
    log.error({ err: error }, "Apple Sign In error:")
    return NextResponse.json(
      { error: "Apple Sign In failed" },
      { status: 500 }
    )
  }
}

// Export with rate limiting (10 requests per minute per IP)
export const POST = withRateLimitHandlerAsync(appleSignInHandler, authRateLimiter)
