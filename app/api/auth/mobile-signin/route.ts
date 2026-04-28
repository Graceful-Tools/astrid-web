import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { createDefaultListsForUser } from "@/lib/default-lists"
import { withRateLimitHandler, authRateLimiter } from "@/lib/rate-limiter"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.mobile-signin')


// Generate cryptographically secure token
function generateSecureToken(prefix: string): string {
  return `${prefix}-${randomBytes(32).toString('hex')}`
}

// Email/password sign in endpoint for iOS
async function mobileSignInHandler(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      )
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    })

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    // Check if user has a password (OAuth users might not)
    if (!user.password) {
      return NextResponse.json(
        { error: "This account uses OAuth sign in. Please use Sign in with Apple or Google." },
        { status: 401 }
      )
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.password)

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      )
    }

    // Check if user has default lists, create if not
    const lists = await prisma.taskList.count({
      where: { ownerId: user.id }
    })

    if (lists === 0) {
      await createDefaultListsForUser(user.id)
    }

    // Create session
    const sessionToken = generateSecureToken('session')
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        sessionToken,
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      },
    })

    // Create response with session cookie
    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    })

    // Set session cookie (same as web app)
    response.cookies.set("next-auth.session-token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: "/",
    })

    return response
  } catch (error) {
    log.error({ err: error }, "Sign in error:")
    return NextResponse.json(
      { error: "Sign in failed" },
      { status: 500 }
    )
  }
}

// Export with rate limiting (10 requests per minute per IP)
export const POST = withRateLimitHandler(mobileSignInHandler, authRateLimiter)
