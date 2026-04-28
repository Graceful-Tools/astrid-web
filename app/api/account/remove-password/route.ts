import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import bcrypt from "bcryptjs"
import { createLogger } from '@/lib/logger'

const log = createLogger('account.remove-password')


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
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { currentPassword } = await request.json()

    // Get user with password and passkeys count
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        password: true,
        _count: {
          select: { authenticators: true }
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Check if user has a password to remove
    if (!user.password) {
      return NextResponse.json(
        { error: "Account does not have a password set" },
        { status: 400 }
      )
    }

    // Verify current password
    if (!currentPassword) {
      return NextResponse.json(
        { error: "Current password is required" },
        { status: 400 }
      )
    }

    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password)
    if (!isCurrentPasswordValid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 }
      )
    }

    // Check if user has at least one passkey
    if (user._count.authenticators === 0) {
      return NextResponse.json(
        { error: "You must have at least one passkey registered before removing your password" },
        { status: 400 }
      )
    }

    // Remove password
    await prisma.user.update({
      where: { id: session.user.id },
      data: { password: null }
    })

    return NextResponse.json({
      success: true,
      message: "Password removed successfully. You can now sign in using only your passkey."
    })

  } catch (error) {
    log.error({ err: error }, "Error removing password:")
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
