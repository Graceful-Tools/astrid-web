import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { prisma } from "@/lib/prisma"
import { adoptUnverifiedAccount } from '@/lib/auth/adopt-unverified-account'
import { verifyGoogleIdentity } from "@/lib/auth/google-identity"
import { createDefaultListsForUser } from "@/lib/default-lists"
import { withRateLimitHandlerAsync, authRateLimiter } from "@/lib/rate-limiter"
import { safeResponseJson } from "@/lib/safe-parse"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.google')


// Generate cryptographically secure token
function generateSecureToken(prefix: string): string {
  return `${prefix}-${randomBytes(32).toString('hex')}`
}

// Google Sign In endpoint for iOS
async function googleSignInHandler(request: NextRequest) {
  const blocked = capabilityGate('authGoogle')
  if (blocked) return blocked

  try {
    const { idToken } = await request.json()

    if (!idToken) {
      return NextResponse.json({ error: "Missing ID token" }, { status: 400 })
    }

    // Verify the ID token with Google
    // Use Google's tokeninfo endpoint for verification
    let googleData
    try {
      // Add 10s timeout to prevent hanging on network issues
      const abortController = new AbortController()
      const timeoutId = setTimeout(() => abortController.abort(), 10000)

      const googleResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        { signal: abortController.signal }
      )

      clearTimeout(timeoutId)

      if (!googleResponse.ok) {
        log.error({
          status: googleResponse.status,
          statusText: googleResponse.statusText
        }, '❌ [GoogleAuth] Token verification failed:')
        return NextResponse.json({ error: "Invalid Google ID token" }, { status: 400 })
      }

      googleData = await safeResponseJson<{
        email?: string
        sub?: string
        name?: string
        picture?: string
        aud?: string
        email_verified?: string | boolean
      }>(googleResponse, null)

      if (!googleData) {
        log.error('❌ [GoogleAuth] Empty response from Google tokeninfo endpoint')
        return NextResponse.json({ error: "Invalid response from Google" }, { status: 500 })
      }
    } catch (error) {
      log.error({
        error: error instanceof Error ? error.message : String(error),
        isAbortError: error instanceof Error && error.name === 'AbortError'
      }, '❌ [GoogleAuth] Network error verifying token:')
      return NextResponse.json(
        { error: "Failed to verify Google ID token" },
        { status: 500 }
      )
    }

    // SECURITY: verify aud (issued for our client) + email_verified — see
    // lib/auth/google-identity.ts.
    const identity = verifyGoogleIdentity(googleData)
    if (!identity.ok) {
      log.error({ reason: identity.reason }, '❌ [GoogleAuth] identity check failed')
      return NextResponse.json({ error: "Invalid Google ID token" }, { status: 401 })
    }

    const userEmail = identity.email!
    const googleUserId = googleData.sub!
    const name = googleData.name || userEmail.split('@')[0]
    const picture = googleData.picture

    // Check if user exists
    let existingUser = await prisma.user.findUnique({
      where: { email: userEmail.toLowerCase() },
      include: { accounts: true }
    })

    if (existingUser) {
      // A row found by email is not proof that its holder owns the address.
      // Passkey signup creates exactly such a row, unverified, for anyone who
      // asks. Google has just affirmed ownership, so adopt the account and drop
      // the credentials that proved nothing (task 1a52195f).
      await adoptUnverifiedAccount(prisma, existingUser, 'google')

      // Check if Google account is already linked
      const googleAccount = existingUser.accounts.find(acc => acc.provider === "google")

      if (!googleAccount) {
        // Link Google account to existing user
        await prisma.account.create({
          data: {
            userId: existingUser.id,
            type: "oauth",
            provider: "google",
            providerAccountId: googleUserId,
            id_token: idToken,
          }
        })
      }

      // Update user info with Google data
      existingUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: existingUser.name || name,
          image: existingUser.image || picture,
          emailVerified: new Date() // Google verifies emails
        },
        include: { accounts: true }
      })
    } else {
      // Create new user
      existingUser = await prisma.user.create({
        data: {
          email: userEmail.toLowerCase(),
          name: name,
          image: picture,
          emailVerified: new Date(),
          accounts: {
            create: {
              type: "oauth",
              provider: "google",
              providerAccountId: googleUserId,
              id_token: idToken,
            }
          }
        },
        include: { accounts: true }
      })

      // Create default lists for new user
      await createDefaultListsForUser(existingUser!.id)
    }

    if (!existingUser) {
      throw new Error("Failed to locate or create user for Google Sign In")
    }

    // Create session (simplified for iOS - in production use proper session management)
    const session = await prisma.session.create({
      data: {
        userId: existingUser.id,
        sessionToken: generateSecureToken('google'),
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
    log.error({ err: error }, "Google Sign In error:")
    return NextResponse.json(
      { error: "Google Sign In failed" },
      { status: 500 }
    )
  }
}

// Export with rate limiting (10 requests per minute per IP)
export const POST = withRateLimitHandlerAsync(googleSignInHandler, authRateLimiter)
