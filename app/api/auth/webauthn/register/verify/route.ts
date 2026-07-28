import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { verifyRegistration, getChallenge, deleteChallenge, isProduction } from "@/lib/webauthn"
import { prisma } from "@/lib/prisma"
import { createDefaultListsForUser } from "@/lib/default-lists"
import { sendEmailVerification } from "@/lib/email-verification"
import { createVerifyEmailTask } from "@/lib/system-tasks"
import { encode } from "next-auth/jwt"
import type { RegistrationResponseJSON } from "@simplewebauthn/types"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.webauthn.register.verify')


export async function POST(request: NextRequest) {
  const blocked = capabilityGate('authPasskey')
  if (blocked) return blocked

  try {
    const body = await request.json()
    const { sessionId, response, name } = body as {
      sessionId: string
      response: RegistrationResponseJSON
      name?: string
    }

    if (!sessionId || !response) {
      return NextResponse.json(
        { error: "Missing sessionId or response" },
        { status: 400 }
      )
    }

    // Retrieve stored challenge
    const storedData = await getChallenge(sessionId)
    log.info(storedData ? {
      hasChallenge: !!storedData.challenge,
      userId: storedData.userId,
      email: storedData.email
    } : null, "[WebAuthn] Verify: storedData =")

    if (!storedData) {
      return NextResponse.json(
        { error: "Challenge expired or not found" },
        { status: 400 }
      )
    }

    // Use getUnifiedSession to support both web (JWT) and mobile (database) sessions
    const session = await getUnifiedSession(request)
    log.info(session?.user?.id ? { userId: session.user.id } : null, "[WebAuthn] Verify: session =")

    let userId: string

    if (session?.user?.id && storedData.userId === session.user.id) {
      // Adding passkey to existing account
      log.info("[WebAuthn] Verify: Adding passkey to existing account")
      userId = session.user.id
    } else if (storedData.email && !storedData.userId) {
      // New account registration - create user (email NOT verified yet)
      log.info({ email: storedData.email }, "[WebAuthn] Verify: Creating new user")
      const user = await prisma.user.create({
        data: {
          email: storedData.email,
          // emailVerified intentionally left null - user must verify email
        },
      })
      userId = user.id

      // Create default lists for new user
      await createDefaultListsForUser(userId)

      // Send verification email
      await sendEmailVerification(userId, storedData.email, false)
      log.info({ email: storedData.email }, "[WebAuthn] Verify: Sent verification email")

      // Create system task to remind user to verify email
      await createVerifyEmailTask(userId)
    } else {
      log.info({ sessionUserId: session?.user?.id, storedUserId: storedData.userId }, '[WebAuthn] Verify: Invalid session state')
      return NextResponse.json(
        { error: "Invalid session state" },
        { status: 400 }
      )
    }

    // Verify the registration (pass request origin for subdomain support)
    const requestOrigin = request.headers.get("origin") || undefined
    const verification = await verifyRegistration(
      userId,
      response,
      storedData.challenge,
      requestOrigin
    )

    if (!verification.verified) {
      return NextResponse.json(
        { error: verification.error || "Registration verification failed" },
        { status: 400 }
      )
    }

    // Clean up challenge
    await deleteChallenge(sessionId)

    // Update passkey name if provided
    if (name) {
      const authenticator = await prisma.authenticator.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
      })
      if (authenticator) {
        await prisma.authenticator.update({
          where: { id: authenticator.id },
          data: { name },
        })
      }
    }

    // Get user for response
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, image: true },
    })

    const isNewUser = !session?.user?.id

    // For new users, create a session so they're logged in immediately
    if (isNewUser && user) {
      const now = Math.floor(Date.now() / 1000)
      const token = await encode({
        token: {
          sub: user.id,
          iat: now,
          exp: now + 30 * 24 * 60 * 60,
          jti: crypto.randomUUID(),
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          provider: "webauthn",
        },
        secret: process.env.NEXTAUTH_SECRET!,
        maxAge: 30 * 24 * 60 * 60,
      })

      const res = NextResponse.json({
        verified: true,
        user,
        isNewUser: true,
      })

      // Set session cookie
      const cookieName = isProduction
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token"

      const cookieOptions: {
        httpOnly: boolean
        secure: boolean
        sameSite: "lax" | "strict" | "none"
        path: string
        maxAge: number
        domain?: string
      } = {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
      }

      if (isProduction) {
        cookieOptions.domain = ".astrid.cc"
      }

      res.cookies.set(cookieName, token, cookieOptions)
      return res
    }

    return NextResponse.json({
      verified: true,
      user,
      isNewUser: false,
    })
  } catch (error) {
    log.error({ err: error }, "[WebAuthn] Registration verify error:")
    return NextResponse.json(
      { error: "Registration verification failed" },
      { status: 500 }
    )
  }
}
