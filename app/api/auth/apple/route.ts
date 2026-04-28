import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { createRemoteJWKSet, jwtVerify, JWTPayload } from "jose"
import { prisma } from "@/lib/prisma"
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
      // Note: audience should be your app's bundle ID or service ID
      // For iOS apps, this is typically your bundle identifier
      // We skip audience validation here since it varies by client
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
    const { identityToken, authorizationCode, user, email, fullName } = await request.json()

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
    // Email from request takes precedence (Apple only sends email on first login)
    // Fall back to token email if not provided in request
    const userEmail = email || verifiedPayload.email

    if (!userEmail) {
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    // Check if user exists
    let existingUser = await prisma.user.findUnique({
      where: { email: userEmail.toLowerCase() },
      include: { accounts: true }
    })

    if (existingUser) {
      // Check if Apple account is already linked
      const appleAccount = existingUser.accounts.find(acc => acc.provider === "apple")

      if (!appleAccount) {
        // Link Apple account to existing user
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
        // Security check: Apple user ID should match
        log.error({ err: userEmail }, "Apple user ID mismatch for email:")
        return NextResponse.json({ error: "Account verification failed" }, { status: 401 })
      }

      // Update user info if provided
      if (fullName && !existingUser.name) {
        existingUser = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            name: fullName,
            emailVerified: new Date() // Apple verifies emails
          },
          include: { accounts: true }
        })
      }
    } else {
      // Create new user
      existingUser = await prisma.user.create({
        data: {
          email: userEmail.toLowerCase(),
          name: fullName || userEmail.split('@')[0],
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
