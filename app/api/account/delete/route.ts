import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { del } from "@vercel/blob"
import bcrypt from "bcryptjs"
import { createLogger } from '@/lib/logger'

const log = createLogger('account.delete')


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

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request)
    if (!session?.user?.id) {
      return new NextResponse("Unauthorized", { status: 401 })
    }

    const body = await request.json()
    const { confirmationText, password } = body

    // Validate confirmation text
    if (confirmationText !== "DELETE MY ACCOUNT") {
      return NextResponse.json(
        { error: "Invalid confirmation text. Please type 'DELETE MY ACCOUNT' exactly." },
        { status: 400 }
      )
    }

    // Get user with password for verification
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      include: {
        secureFiles: true,
        accounts: true,
        authenticators: true
      }
    })

    if (!user) {
      return new NextResponse("User not found", { status: 404 })
    }

    // Verify password (if user has email/password auth)
    if (user.password) {
      if (!password) {
        return NextResponse.json(
          { error: "Password required for account deletion" },
          { status: 400 }
        )
      }

      const isValidPassword = await bcrypt.compare(password, user.password)
      if (!isValidPassword) {
        return NextResponse.json(
          { error: "Invalid password" },
          { status: 401 }
        )
      }
    } else {
      // Non-password user - verify they have a valid auth method (OAuth or passkey)
      const hasOAuthAccount = user.accounts.some(
        acc => acc.provider === 'google' || acc.provider === 'github' || acc.provider === 'apple'
      )
      const hasPasskey = user.authenticators && user.authenticators.length > 0

      if (!hasOAuthAccount && !hasPasskey) {
        return NextResponse.json(
          { error: "Account authentication method not found" },
          { status: 400 }
        )
      }
      // OAuth or passkey users just need confirmation text since they're already authenticated
    }

    // Delete all user files from Vercel Blob storage
    if (user.secureFiles.length > 0) {
      // Use Promise.allSettled to attempt all deletions even if some fail
      const deletionResults = await Promise.allSettled(
        user.secureFiles.map(file => del(file.blobUrl))
      )

      // Log any failures but continue with account deletion
      const failedDeletions = deletionResults.filter(r => r.status === 'rejected')
      if (failedDeletions.length > 0) {
        log.error({
          total: user.secureFiles.length,
          failed: failedDeletions.length,
          errors: failedDeletions.map((r, i) => ({
            file: user.secureFiles[i]?.blobUrl,
            error: r.status === 'rejected' ? r.reason : null
          }))
        }, `Failed to delete ${failedDeletions.length} files during account deletion:`)
      }
    }

    // Delete user account (cascades will handle related data)
    await prisma.user.delete({
      where: { id: session.user.id }
    })

    // Note: Session will be invalidated on next request
    // The database cascades will automatically delete:
    // - Accounts (OAuth tokens)
    // - Sessions
    // - Tasks (created and assigned)
    // - Lists (owned)
    // - Comments
    // - List memberships
    // - Invitations
    // - Secure files
    // - MCP tokens
    // - Push subscriptions
    // - Reminder queue
    // - Reminder settings
    // - GitHub integration

    return NextResponse.json({
      success: true,
      message: "Account successfully deleted"
    })

  } catch (error) {
    log.error({ err: error }, "Account deletion error:")
    return NextResponse.json(
      { error: "Failed to delete account. Please try again or contact support." },
      { status: 500 }
    )
  }
}
