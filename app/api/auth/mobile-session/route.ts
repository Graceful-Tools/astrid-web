import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { decode } from "next-auth/jwt"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.mobile-session')


// Session validation endpoint for iOS
// Supports both:
// 1. JWT tokens (from passkey auth, NextAuth JWT strategy)
// 2. Database sessions (from Apple/Google mobile auth)
export async function GET(request: NextRequest) {
  try {
    // Get session token from cookie
    const cookies = request.cookies
    const sessionCookie = cookies.get("next-auth.session-token") || cookies.get("__Secure-next-auth.session-token")

    if (!sessionCookie) {
      return NextResponse.json(
        { error: "No session found" },
        { status: 401 }
      )
    }

    // First, try to decode as JWT (passkey auth, NextAuth JWT strategy)
    try {
      const decoded = await decode({
        token: sessionCookie.value,
        secret: process.env.NEXTAUTH_SECRET!,
      })

      if (decoded && decoded.id && typeof decoded.exp === 'number') {
        // Check if JWT is expired
        const now = Math.floor(Date.now() / 1000)
        if ((decoded.exp as number) < now) {
          return NextResponse.json(
            { error: "Session expired" },
            { status: 401 }
          )
        }

        // JWT is valid - return user data from token
        return NextResponse.json({
          user: {
            id: decoded.id as string,
            email: decoded.email as string,
            name: decoded.name as string | null,
            image: decoded.image as string | null,
          },
        })
      }
    } catch {
      // JWT decode failed, try database session below
    }

    // Fallback: Try database session (Apple/Google mobile auth)
    const session = await prisma.session.findUnique({
      where: { sessionToken: sessionCookie.value },
      include: { user: true },
    })

    if (!session) {
      return NextResponse.json(
        { error: "Invalid session" },
        { status: 401 }
      )
    }

    // Check if session is expired
    if (session.expires < new Date()) {
      await prisma.session.delete({
        where: { id: session.id },
      })
      return NextResponse.json(
        { error: "Session expired" },
        { status: 401 }
      )
    }

    // Return user data
    return NextResponse.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      },
    })
  } catch (error) {
    log.error({ err: error }, "Session validation error:")
    return NextResponse.json(
      { error: "Session validation failed" },
      { status: 500 }
    )
  }
}
