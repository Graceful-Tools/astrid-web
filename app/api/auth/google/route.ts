import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from "next/server"
import { verifyGoogleIdentity } from "@/lib/auth/google-identity"
import { completeNativeSignIn } from '@/lib/auth/native-sign-in'
import { withRateLimitHandlerAsync, authRateLimiter } from "@/lib/rate-limiter"
import { safeResponseJson } from "@/lib/safe-parse"
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.google')


// Google Sign In endpoint for iOS
async function googleSignInHandler(request: NextRequest) {
  const blocked = capabilityGate('authGoogle')
  if (blocked) return blocked

  try {
    const { idToken } = await request.json()

    if (!idToken) {
      return NextResponse.json({ error: "Missing ID token" }, { status: 400 })
    }

    // Verify the ID token with Google
    // Use Google's tokeninfo endpoint for verification
    let googleData
    try {
      // Add 10s timeout to prevent hanging on network issues
      const abortController = new AbortController()
      const timeoutId = setTimeout(() => abortController.abort(), 10000)

      const googleResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        { signal: abortController.signal }
      )

      clearTimeout(timeoutId)

      if (!googleResponse.ok) {
        log.error({
          status: googleResponse.status,
          statusText: googleResponse.statusText
        }, '❌ [GoogleAuth] Token verification failed:')
        return NextResponse.json({ error: "Invalid Google ID token" }, { status: 400 })
      }

      googleData = await safeResponseJson<{
        email?: string
        sub?: string
        name?: string
        picture?: string
        aud?: string
        email_verified?: string | boolean
      }>(googleResponse, null)

      if (!googleData) {
        log.error('❌ [GoogleAuth] Empty response from Google tokeninfo endpoint')
        return NextResponse.json({ error: "Invalid response from Google" }, { status: 500 })
      }
    } catch (error) {
      log.error({
        error: error instanceof Error ? error.message : String(error),
        isAbortError: error instanceof Error && error.name === 'AbortError'
      }, '❌ [GoogleAuth] Network error verifying token:')
      return NextResponse.json(
        { error: "Failed to verify Google ID token" },
        { status: 500 }
      )
    }

    // SECURITY: verify aud (issued for our client) + email_verified — see
    // lib/auth/google-identity.ts.
    const identity = verifyGoogleIdentity(googleData)
    if (!identity.ok) {
      log.error({ reason: identity.reason }, '❌ [GoogleAuth] identity check failed')
      return NextResponse.json({ error: "Invalid Google ID token" }, { status: 401 })
    }

    // Find-or-link-or-create and the session are shared with the other native
    // routes (AWTD-1104): lib/auth/native-sign-in.ts.
    return await completeNativeSignIn({
      provider: 'google',
      providerAccountId: googleData.sub!,
      idToken,
      email: identity.email!,
      // verifyGoogleIdentity has already refused anything Google did not verify.
      emailTrust: 'verified',
      profile: { name: googleData.name, image: googleData.picture },
    })

  } catch (error) {
    log.error({ err: error }, "Google Sign In error:")
    return NextResponse.json(
      { error: "Google Sign In failed" },
      { status: 500 }
    )
  }
}

// Export with rate limiting (10 requests per minute per IP)
export const POST = withRateLimitHandlerAsync(googleSignInHandler, authRateLimiter)
