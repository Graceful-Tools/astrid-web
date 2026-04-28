import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { sendEmailVerification, checkEmailVerificationStatus } from "@/lib/email-verification"
import { createLogger } from '@/lib/logger'

const log = createLogger('account')


export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface UpdateAccountData {
  name?: string
  email?: string
  image?: string
}

// Helper to get session from either JWT (web) or database (mobile)
async function getSession(request: NextRequest) {
  // Try JWT session first (web app)
  const jwtSession = await getServerSession(authConfig)
  if (jwtSession?.user?.id) {
    return { user: { id: jwtSession.user.id } }
  }

  // Try database session (mobile app)
  const sessionCookie = request.cookies.get("next-auth.session-token")
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

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        password: true,
        pendingEmail: true,
        createdAt: true,
        updatedAt: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const verificationStatus = await checkEmailVerificationStatus(user.id)

    // Don't include actual password hash in response
    const { password, ...userWithoutPassword } = user

    return NextResponse.json({
      user: {
        ...userWithoutPassword,
        ...verificationStatus,
        hasPassword: !!password
      }
    })
  } catch (error) {
    log.error({ err: error }, "Error fetching account:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getSession(request)

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data: UpdateAccountData = await request.json()

    // Validate input
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 })
    }

    if (data.name && data.name.length > 100) {
      return NextResponse.json({ error: "Name too long" }, { status: 400 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, email: true, name: true }
    })

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    let updateData: any = {}
    let emailVerificationRequired = false

    // Handle name update
    if (data.name !== undefined && data.name !== user.name) {
      updateData.name = data.name.trim() || null
    }

    // Handle image update
    if (data.image !== undefined) {
      updateData.image = data.image || null
    }

    // Handle email update
    if (data.email && data.email !== user.email) {
      // Check if email is already taken
      const existingUser = await prisma.user.findFirst({
        where: {
          email: data.email.toLowerCase(),
          NOT: { id: session.user.id }
        }
      })

      if (existingUser) {
        return NextResponse.json({ 
          error: "Email address is already in use" 
        }, { status: 409 })
      }

      // Send verification email for the new address
      const verificationResult = await sendEmailVerification(
        session.user.id, 
        data.email.toLowerCase(), 
        true // isEmailChange
      )

      if (!verificationResult.success) {
        return NextResponse.json({ 
          error: verificationResult.message 
        }, { status: 500 })
      }

      emailVerificationRequired = true
    }

    // Update user data (email will be updated after verification)
    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: session.user.id },
        data: updateData
      })
    }

    const response: any = {
      success: true,
      message: "Account updated successfully"
    }

    if (emailVerificationRequired) {
      response.emailVerificationRequired = true
      response.message += ". Please check your email to verify the new address."
    }

    return NextResponse.json(response)
  } catch (error) {
    log.error({ err: error }, "Error updating account:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
