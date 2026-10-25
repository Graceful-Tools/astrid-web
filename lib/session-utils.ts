import { NextRequest } from "next/server"
import { getServerSession } from "next-auth"
import { getToken } from "next-auth/jwt"
import { authConfig } from "./auth-config"
import { sessionFromCookieValue } from "./auth/session-cookie"

/**
 * Unified session validation that supports both:
 * 1. JWT sessions (web app via NextAuth)
 * 2. Database sessions (mobile app via custom OAuth endpoints)
 *
 * Returns the user if authenticated, null otherwise.
 */
export async function getUnifiedSession(request?: NextRequest) {
  if (request) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET })

    if (token?.id) {
      return {
        user: {
          id: token.id as string,
          email: token.email as string,
          name: (token.name as string | null) || null,
          image: (token.picture as string | null) || (token.image as string | null) || null,
        }
      }
    }
  }

  // Try JWT session first (web app)
  const jwtSession = await getServerSession(authConfig)

  if (jwtSession?.user?.id) {
    return {
      user: {
        id: jwtSession.user.id,
        email: jwtSession.user.email!,
        name: jwtSession.user.name || null,
        image: jwtSession.user.image || null,
      }
    }
  }

  // The native routes' cookie: a JWT under its plain name, or a pre-AWTD-1104
  // database session (mobile app).
  if (request?.cookies) {
    const cookies = request.cookies
    const sessionCookie = cookies.get("next-auth.session-token") || cookies.get("__Secure-next-auth.session-token")

    if (sessionCookie) {
      const session = await sessionFromCookieValue(sessionCookie.value)
      if (session) return { user: session.user }
    }
  }

  return null
}
