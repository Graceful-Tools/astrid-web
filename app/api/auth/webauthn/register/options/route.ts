import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { getRegistrationOptions, storeChallenge } from "@/lib/webauthn"
import { prisma } from "@/lib/prisma"
import { v4 as uuid } from "uuid"
import { passkeyRateLimiter, withRateLimitHandlerAsync } from "@/lib/rate-limiter"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.webauthn.register.options')


async function registrationOptionsHandler(request: NextRequest) {
  const blocked = capabilityGate('authPasskey')
  if (blocked) return blocked

  try {
    // Check for authenticated session (for adding passkey to existing account)
    // Use getUnifiedSession to support both web (JWT) and mobile (database) sessions
    const session = await getUnifiedSession(request)

    // For new account registration without session
    const body = await request.json().catch(() => ({}))
    const { email } = body

    let userId: string
    let userEmail: string

    if (session?.user?.id) {
      // Adding passkey to existing account
      userId = session.user.id
      userEmail = session.user.email || ""

      // If no email in session, fetch from database
      if (!userEmail) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { email: true },
        })
        userEmail = user?.email || ""
      }

      if (!userEmail) {
        return NextResponse.json(
          { error: "User email not found" },
          { status: 400 }
        )
      }
    } else if (email) {
      // Whether this email already has an account is NOT answerable here: this
      // route is unauthenticated, so any difference in the response is a free
      // account-enumeration oracle (task c2fbe8e4). Everyone gets the same
      // challenge; /register/verify resolves the existing-account case, and it
      // costs the caller a real WebAuthn ceremony to get that far.
      // Registration options are generated against a throwaway user id so an
      // existing account's credential list never leaks through excludeCredentials.
      userId = uuid()
      userEmail = email.toLowerCase()
    } else {
      return NextResponse.json(
        { error: "Email required for new account registration" },
        { status: 400 }
      )
    }

    const requestOrigin = request.headers.get("origin") || undefined
    const options = await getRegistrationOptions(userId, userEmail, requestOrigin)

    // Store challenge with session ID for verification
    const sessionId = uuid()
    await storeChallenge(sessionId, {
      challenge: options.challenge,
      userId: session?.user?.id, // Only set for existing users
      email: userEmail,
    })

    return NextResponse.json({
      options,
      sessionId,
    })
  } catch (error) {
    log.error({ err: error }, "[WebAuthn] Registration options error:")
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json(
      { error: `Failed to generate registration options: ${errorMessage}` },
      { status: 500 }
    )
  }
}

export const POST = withRateLimitHandlerAsync(registrationOptionsHandler, passkeyRateLimiter)
