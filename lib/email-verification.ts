import { prisma } from "./prisma"
import { sendVerificationEmail } from "./email"
import { completeVerifyEmailTask } from "./system-tasks"
import crypto from "crypto"
import { createLogger } from '@/lib/logger'

const log = createLogger('email-verification')


export interface EmailVerificationResult {
  success: boolean
  message: string
  requiresVerification?: boolean
}

/**
 * Generate a secure email verification token
 */
function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

/**
 * Send email verification to user
 */
export async function sendEmailVerification(
  userId: string, 
  email?: string, 
  isEmailChange = false
): Promise<EmailVerificationResult> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, pendingEmail: true }
    })

    if (!user) {
      return { success: false, message: "User not found" }
    }

    const targetEmail = email || user.email
    const token = generateVerificationToken()
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    // Update user with verification token
    await prisma.user.update({
      where: { id: userId },
      data: {
        emailVerificationToken: token,
        emailTokenExpiresAt: expiresAt,
        ...(isEmailChange && email && { pendingEmail: email })
      }
    })

    // Send verification email
    await sendVerificationEmail({
      email: targetEmail,
      token,
      userName: user.name || targetEmail,
      isEmailChange,
      currentEmail: user.email
    })

    return {
      success: true,
      message: isEmailChange 
        ? `Verification email sent to ${targetEmail}`
        : "Verification email sent",
      requiresVerification: true
    }
  } catch (error) {
    log.error({ err: error }, "Error sending email verification:")
    return { success: false, message: "Failed to send verification email" }
  }
}

/**
 * Verify email with token
 */
export async function verifyEmailToken(token: string): Promise<EmailVerificationResult> {
  try {
    const user = await prisma.user.findFirst({
      where: {
        emailVerificationToken: token,
        emailTokenExpiresAt: {
          gt: new Date()
        }
      }
    })

    if (!user) {
      return { success: false, message: "Invalid or expired verification token" }
    }

    const updateData: any = {
      emailVerificationToken: null,
      emailTokenExpiresAt: null,
      emailVerified: new Date()
    }

    // If this is an email change verification
    if (user.pendingEmail) {
      updateData.email = user.pendingEmail
      updateData.pendingEmail = null
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData
    })

    // Auto-complete the verify email system task
    await completeVerifyEmailTask(user.id)

    return {
      success: true,
      message: user.pendingEmail
        ? "Email address updated and verified successfully"
        : "Email verified successfully"
    }
  } catch (error) {
    log.error({ err: error }, "Error verifying email token:")
    return { success: false, message: "Email verification failed" }
  }
}

/**
 * Check if user needs email verification
 */
export async function checkEmailVerificationStatus(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { 
      emailVerified: true, 
      pendingEmail: true,
      emailVerificationToken: true,
      emailTokenExpiresAt: true,
      accounts: {
        select: {
          provider: true
        }
      }
    }
  })

  if (!user) {
    return { verified: false, hasPendingChange: false, hasPendingVerification: false }
  }

  // Check if user has OAuth accounts (Google, etc.) - these users are automatically verified
  const hasOAuthAccount = user.accounts && user.accounts.length > 0

  // User is verified if they have OAuth accounts OR if they've completed email verification
  const isVerified = hasOAuthAccount || !!user.emailVerified

  const hasPendingVerification = !!(
    user.emailVerificationToken && 
    user.emailTokenExpiresAt && 
    user.emailTokenExpiresAt > new Date()
  )

  return {
    verified: isVerified,
    hasPendingChange: !!user.pendingEmail,
    hasPendingVerification,
    pendingEmail: user.pendingEmail,
    verifiedViaOAuth: hasOAuthAccount
  }
}

/**
 * Cancel pending email change
 */
export async function cancelEmailChange(userId: string): Promise<EmailVerificationResult> {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        pendingEmail: null,
        emailVerificationToken: null,
        emailTokenExpiresAt: null
      }
    })

    return { success: true, message: "Email change cancelled" }
  } catch (error) {
    log.error({ err: error }, "Error cancelling email change:")
    return { success: false, message: "Failed to cancel email change" }
  }
}

/**
 * Resend verification email
 */
export async function resendVerificationEmail(userId: string): Promise<EmailVerificationResult> {
  const status = await checkEmailVerificationStatus(userId)
  
  if (status.verified && !status.hasPendingChange) {
    return { success: false, message: "Email is already verified" }
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { pendingEmail: true }
  })

  return sendEmailVerification(
    userId, 
    user?.pendingEmail || undefined, 
    !!user?.pendingEmail
  )
}
