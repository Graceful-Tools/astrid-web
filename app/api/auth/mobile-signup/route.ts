import { NextRequest, NextResponse } from "next/server"
import { randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"

// Generate cryptographically secure token
function generateSecureToken(prefix: string): string {
  return `${prefix}-${randomBytes(32).toString('hex')}`
}
import { withRateLimitHandler, signupRateLimiter } from "@/lib/rate-limiter"
import { sendEmailVerification } from "@/lib/email-verification"
import { createDefaultListsForUser } from "@/lib/default-lists"
import { placeholderUserService } from "@/lib/placeholder-user-service"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.mobile-signup')


// Email sign up endpoint for iOS (password optional)
async function signupHandler(request: NextRequest) {
  try {
    const { email, password, name } = await request.json()

    // Validate input - only email is required
    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      )
    }

    // Password is optional but if provided must be valid
    if (password && password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters long" },
        { status: 400 }
      )
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      )
    }

    // Block reserved @astrid.cc emails (used for AI agents)
    if (email.toLowerCase().endsWith('@astrid.cc')) {
      return NextResponse.json(
        { error: "This email domain is reserved for system use" },
        { status: 403 }
      )
    }

    // Check if user already exists or is a placeholder
    const normalizedEmail = email.toLowerCase()
    const { canUpgrade, placeholderUser } = await placeholderUserService.canUpgradePlaceholder(normalizedEmail)

    if (placeholderUser && !canUpgrade) {
      // Real user already exists
      return NextResponse.json(
        { error: "User with this email already exists" },
        { status: 409 }
      )
    }

    // Hash password only if provided
    const hashedPassword = password ? await bcrypt.hash(password, 12) : null

    let user

    if (canUpgrade && placeholderUser) {
      // Upgrade placeholder user to full user
      log.info(`📧 Upgrading placeholder user ${placeholderUser.email} to full user`)
      user = await placeholderUserService.upgradePlaceholderToFullUser(
        placeholderUser.id,
        {
          name: name?.trim() || placeholderUser.name || null,
          password: hashedPassword,
          emailVerified: new Date(), // Auto-verify when upgrading from placeholder
        }
      )
      log.info(`✅ Placeholder user upgraded successfully. User now has access to ${await prisma.task.count({ where: { assigneeId: user.id } })} assigned tasks`)
    } else {
      // Create new user
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          password: hashedPassword,
          name: name?.trim() || null,
          // Don't auto-verify email - user must verify via email link
        },
        select: {
          id: true,
          email: true,
          name: true,
          image: true,
          emailVerified: true,
          createdAt: true,
        }
      })
    }

    // Create default filter lists for the new user
    try {
      await createDefaultListsForUser(user.id)
    } catch (error) {
      log.error({ err: error }, "Failed to create default lists:")
      // Don't fail the signup if default list creation fails
    }

    // Send verification email to the new user
    try {
      await sendEmailVerification(user.id)
    } catch (error) {
      log.error({ err: error }, "Failed to send verification email:")
      // Don't fail the signup if verification email fails
    }

    // Create session for iOS
    const sessionToken = generateSecureToken('session')
    await prisma.session.create({
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

    // Set session cookie (same as mobile-signin)
    response.cookies.set("next-auth.session-token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60, // 30 days
      path: "/",
    })

    return response

  } catch (error) {
    log.error({ err: error }, "Error in mobile signup:")
    return NextResponse.json(
      { error: "Sign up failed" },
      { status: 500 }
    )
  }
}

// Export with rate limiting (5 requests per 5 minutes)
export const POST = withRateLimitHandler(signupHandler, signupRateLimiter)
