import { BRAND } from '@/lib/brand/config'
import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from "next/server"
import { verifyAuthentication, getChallenge, deleteChallenge, isProduction } from "@/lib/webauthn"
import { encode } from "next-auth/jwt"
import type { AuthenticationResponseJSON } from "@simplewebauthn/types"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.webauthn.authenticate.verify')


export async function POST(request: NextRequest) {
  const blocked = capabilityGate('authPasskey')
  if (blocked) return blocked

  try {
    const body = await request.json()
    const { sessionId, response } = body as {
      sessionId: string
      response: AuthenticationResponseJSON
    }

    if (!sessionId || !response) {
      return NextResponse.json(
        { error: "Missing sessionId or response" },
        { status: 400 }
      )
    }

    // Retrieve stored challenge
    const storedData = await getChallenge(sessionId)
    if (!storedData) {
      return NextResponse.json(
        { error: "Challenge expired or not found" },
        { status: 400 }
      )
    }

    // Burn the challenge BEFORE verifying, not after. A WebAuthn challenge is
    // single-use by definition, but this used to be deleted only on the success
    // path, so a failed or replayed assertion left it live for the rest of its
    // five-minute TTL and a captured assertion could be replayed inside that
    // window (task 1a52195f).
    await deleteChallenge(sessionId)

    // Verify the authentication (pass request origin for subdomain support)
    const requestOrigin = request.headers.get("origin") || undefined
    const verification = await verifyAuthentication(response, storedData.challenge, requestOrigin)

    if (!verification.verified || !verification.user) {
      return NextResponse.json(
        { error: verification.error || "Authentication failed" },
        { status: 401 }
      )
    }

    const user = verification.user

    // Create a JWT token for the session
    // Must match the structure that NextAuth's jwt callback expects
    const now = Math.floor(Date.now() / 1000)
    const token = await encode({
      token: {
        // Standard JWT claims
        sub: user.id,
        iat: now,
        exp: now + 30 * 24 * 60 * 60,
        jti: crypto.randomUUID(),
        // NextAuth custom claims (matching jwt callback structure)
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        provider: "webauthn",
      },
      secret: process.env.NEXTAUTH_SECRET!,
      maxAge: 30 * 24 * 60 * 60, // 30 days
    })

    // Create the response with the session cookie
    const res = NextResponse.json({
      verified: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
      },
    })

    // Set session cookie - use robust production detection
    const cookieName = isProduction
      ? "__Secure-next-auth.session-token"
      : "next-auth.session-token"

    const cookieOptions: {
      httpOnly: boolean
      secure: boolean
      sameSite: "lax" | "strict" | "none"
      path: string
      maxAge: number
      domain?: string
    } = {
      httpOnly: true,
      secure: isProduction,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60, // 30 days
    }

    if (isProduction) {
      // Scoped to the brand domain and its subdomains (leading dot), so a session
      // started on the apex is valid on preview subdomains. Task 97208a72.
      cookieOptions.domain = `.${BRAND.domain}`
    }

    res.cookies.set(cookieName, token, cookieOptions)

    return res
  } catch (error) {
    log.error({ err: error }, "[WebAuthn] Authentication verify error:")
    return NextResponse.json(
      { error: "Authentication verification failed" },
      { status: 500 }
    )
  }
}
