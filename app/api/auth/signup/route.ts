import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { withRateLimitHandler, signupRateLimiter } from "@/lib/rate-limiter"
import { sendEmailVerification } from "@/lib/email-verification"
import { createDefaultListsForUser } from "@/lib/default-lists"
import { createVerifyEmailTask } from "@/lib/system-tasks"
import { placeholderUserService } from "@/lib/placeholder-user-service"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.signup')


async function signupHandler(request: NextRequest) {
  try {
    const { email, password, name } = await request.json()

    // Validate input - only email is required now
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

    // Check if it's an existing user without a password (passwordless signup step 2)
    if (placeholderUser && !canUpgrade) {
      // Check if this is a passwordless account that needs a password set
      const existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, password: true, email: true, name: true, emailVerified: true }
      })

      if (existingUser && !existingUser.password && password) {
        // User exists without password - this is step 2 of passwordless signup, set the password
        const hashedPassword = await bcrypt.hash(password, 12)
        const updatedUser = await prisma.user.update({
          where: { id: existingUser.id },
          data: { password: hashedPassword },
          select: { id: true, email: true, name: true, emailVerified: true }
        })
        log.info(`✅ Password set for passwordless account: ${existingUser.email}`)
        return NextResponse.json({
          success: true,
          message: "Password set successfully",
          passwordSet: true,
          user: {
            id: updatedUser.id,
            email: updatedUser.email,
            name: updatedUser.name,
            emailVerified: updatedUser.emailVerified,
          }
        })
      }

      // Real user already exists with password
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

    // Create system task to remind user to verify email
    try {
      await createVerifyEmailTask(user.id)
    } catch (error) {
      log.error({ err: error }, "Failed to create verify email task:")
      // Don't fail the signup if task creation fails
    }

    return NextResponse.json({
      success: true,
      message: canUpgrade ? "Account activated! You now have access to all your assigned tasks." : "User created successfully",
      wasUpgraded: canUpgrade,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
      }
    })

  } catch (error) {
    log.error({ err: error }, "Error in signup:")
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

// Export with rate limiting (5 requests per 5 minutes)
export const POST = withRateLimitHandler(signupHandler, signupRateLimiter)
