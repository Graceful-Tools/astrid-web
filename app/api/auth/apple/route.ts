import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose"
import { prisma } from "@/lib/prisma"
import { resolveAppleIdentity, appleAllowedAudiences } from "@/lib/auth/apple-identity"
import { createDefaultListsForUser } from "@/lib/default-lists"
import { withRateLimitHandler, authRateLimiter } from "@/lib/rate-limiter"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.apple')


// Generate cryptographically secure token
function generateSecureToken(prefix: string): string {
  return `${prefix}-${randomBytes(32).toString('hex')}`
}

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

    const appleUserId = verifiedPayload.sub
    // Identity comes ONLY from the verified token — the body email was
    // previously trusted over the claim (account-takeover vector). See
    // lib/auth/apple-identity.ts for the contract.
    const { email: tokenEmail, emailVerified } = resolveAppleIdentity(verifiedPayload)

    // Returning user: the Apple account row is the primary key.
    const linkedAccount = await prisma.account.findFirst({
      where: { provider: "apple", providerAccountId: appleUserId },
    })

    let existingUser =
      linkedAccount
        ? await prisma.user.findUnique({
            where: { id: linkedAccount.userId },
            include: { accounts: true },
          })
        : null

    if (!existingUser) {
      if (!tokenEmail) {
        return NextResponse.json({ error: "Email is required" }, { status: 400 })
      }
      existingUser = await prisma.user.findUnique({
        where: { email: tokenEmail },
        include: { accounts: true }
      })

      if (existingUser) {
        // Linking onto an EXISTING account requires Apple to affirm the
        // email is verified.
        if (!emailVerified) {
          log.error({ appleUserId }, "Apple link refused: email not verified by token")
          return NextResponse.json({ error: "Account verification failed" }, { status: 401 })
        }
        const appleAccount = existingUser.accounts.find(acc => acc.provider === "apple")
        if (!appleAccount) {
          await prisma.account.create({
            data: {
              userId: existingUser.id,
              type: "oauth",
              provider: "apple",
              providerAccountId: appleUserId,
              id_token: identityToken,
            }
          })
        } else if (appleAccount.providerAccountId !== appleUserId) {
          log.error({ appleUserId }, "Apple user ID mismatch for email:")
          return NextResponse.json({ error: "Account verification failed" }, { status: 401 })
        }
      } else {
        // Create new user
        existingUser = await prisma.user.create({
          data: {
            email: tokenEmail,
            name: fullName || tokenEmail.split('@')[0],
            emailVerified: new Date(),
            accounts: {
              create: {
                type: "oauth",
                provider: "apple",
                providerAccountId: appleUserId,
                id_token: identityToken,
              }
            }
          },
          include: { accounts: true }
        })

        // Create default lists for new user
        await createDefaultListsForUser(existingUser.id)
      }
    }

    // Update user info if provided
    if (existingUser && fullName && !existingUser.name) {
      existingUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: { name: fullName },
        include: { accounts: true }
      })
    }

    if (!existingUser) {
      throw new Error("Failed to locate or create user for Apple Sign In")
    }

    // Create session
    const session = await prisma.session.create({
      data: {
        userId: existingUser.id,
        sessionToken: generateSecureToken('apple'),
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      }
    })

    // Generate CSRF token (required for NextAuth POST requests)
    const csrfToken = generateSecureToken('csrf')

    // Create response with session cookie
    const response = NextResponse.json({
      user: {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        image: existingUser.image,
      },
    })

    // Set session cookie (same as web app and mobile-signin)
    response.cookies.set("next-auth.session-token", session.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: "/",
    })

    // Set CSRF token (required for authenticated POST requests)
    response.cookies.set("next-auth.csrf-token", csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: "/",
    })

    return response

  } catch (error) {
    log.error({ err: error }, "Apple Sign In error:")
    return NextResponse.json(
      { error: "Apple Sign In failed" },
      { status: 500 }
    )
  }
}

// Export with rate limiting (10 requests per minute per IP)
export const POST = withRateLimitHandler(appleSignInHandler, authRateLimiter)
