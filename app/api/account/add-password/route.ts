import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { withRateLimitHandler, passwordChangeRateLimiter } from "@/lib/rate-limiter"
import { createLogger } from '@/lib/logger'

const log = createLogger('account.add-password')


// Helper to get session from either JWT (web) or database (mobile)
async function getSession(request: NextRequest) {
  // Try JWT session first (web app)
  const jwtSession = await getServerSession(authConfig)
  if (jwtSession?.user?.id) {
    return { user: { id: jwtSession.user.id } }
  }

  // Try database session (mobile app)
  const sessionCookie = request.cookies.get("next-auth.session-token")
    || request.cookies.get("__Secure-next-auth.session-token")
  if (!sessionCookie) {
    return null
  }

  const dbSession = await prisma.session.findUnique({
    where: { sessionToken: sessionCookie.value },
    include: { user: true },
  })

  if (!dbSession || dbSession.expires < new Date()) {
    return null
  }

  return { user: { id: dbSession.user.id } }
}

async function addPasswordHandler(request: NextRequest) {
  try {
    const session = await getSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { password } = await request.json()

    // Validate input
    if (!password) {
      return NextResponse.json(
        { error: "Password is required" },
        { status: 400 }
      )
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters long" },
        { status: 400 }
      )
    }

    // Get user and check if they already have a password
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, password: true }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Check if user already has a password
    if (user.password) {
      return NextResponse.json(
        { error: "Account already has a password. Use change password instead." },
        { status: 400 }
      )
    }

    // Hash and set password
    const hashedPassword = await bcrypt.hash(password, 12)

    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: hashedPassword }
    })

    return NextResponse.json({
      success: true,
      message: "Password added successfully. You can now sign in with email and password."
    })

  } catch (error) {
    log.error({ err: error }, "Error adding password:")
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

// Export with rate limiting (3 requests per 5 minutes)
export const POST = withRateLimitHandler(addPasswordHandler, passwordChangeRateLimiter)
