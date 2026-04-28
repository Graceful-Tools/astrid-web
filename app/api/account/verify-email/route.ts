import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authConfig } from "@/lib/auth-config"
import { prisma } from "@/lib/prisma"
import { verifyEmailToken, sendEmailVerification, resendVerificationEmail, cancelEmailChange } from "@/lib/email-verification"
import { createLogger } from '@/lib/logger'

const log = createLogger('account.verify-email')


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
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')
    const action = searchParams.get('action')

    // Handle token verification
    if (token) {
      const result = await verifyEmailToken(token)
      return NextResponse.json(result, {
        status: result.success ? 200 : 400
      })
    }

    // Handle other actions (require authentication)
    const session = await getSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    switch (action) {
      case 'resend':
        const resendResult = await resendVerificationEmail(session.user.id)
        return NextResponse.json(resendResult, {
          status: resendResult.success ? 200 : 400
        })

      case 'cancel':
        const cancelResult = await cancelEmailChange(session.user.id)
        return NextResponse.json(cancelResult, {
          status: cancelResult.success ? 200 : 400
        })

      case 'send':
        const sendResult = await sendEmailVerification(session.user.id)
        return NextResponse.json(sendResult, {
          status: sendResult.success ? 200 : 400
        })

      default:
        return NextResponse.json({ 
          error: "Invalid action. Use 'resend', 'cancel', or 'send'" 
        }, { status: 400 })
    }
  } catch (error) {
    log.error({ err: error }, "Error in email verification:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
