/**
 * POST /api/v1/auth/google
 *
 * Google Sign In for iOS. Verifies the ID token via Google's tokeninfo
 * endpoint; linking and the session are lib/auth/native-sign-in.ts, shared
 * with the other native routes (AWTD-1104). Mirrors POST /api/auth/google —
 * same behaviour, plus the v1 `meta` envelope.
 */

import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from 'next/server'
import { verifyGoogleIdentity } from "@/lib/auth/google-identity"
import { completeNativeSignIn } from '@/lib/auth/native-sign-in'
import { withRateLimitHandlerAsync, authRateLimiter } from '@/lib/rate-limiter'
import { safeResponseJson } from '@/lib/safe-parse'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.auth.google')

async function googleSignInHandler(request: NextRequest) {
  // A deployment that turns Google sign-in off must have it off everywhere. This
  // route mints a 30-day session, so leaving it reachable would make the brand
  // switch cosmetic — and v1 is the path iOS uses. Before the body is read, so a
  // disabled method cannot be probed for its validation behaviour. (Task 3ba0719f.)
  const blocked = capabilityGate('authGoogle')
  if (blocked) return blocked

  try {
    const { idToken } = await request.json()

    if (!idToken) {
      return NextResponse.json({ error: 'Missing ID token' }, { status: 400 })
    }

    let googleData: { email?: string; sub?: string; name?: string; picture?: string; aud?: string; email_verified?: string | boolean } | null
    try {
      const abortController = new AbortController()
      const timeoutId = setTimeout(() => abortController.abort(), 10000)
      const googleResponse = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
        { signal: abortController.signal }
      )
      clearTimeout(timeoutId)

      if (!googleResponse.ok) {
        log.error(
          { status: googleResponse.status, statusText: googleResponse.statusText },
          'Google token verification failed'
        )
        return NextResponse.json({ error: 'Invalid Google ID token' }, { status: 400 })
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
        log.error('Empty response from Google tokeninfo endpoint')
        return NextResponse.json({ error: 'Invalid response from Google' }, { status: 500 })
      }
    } catch (error) {
      log.error(
        {
          error: error instanceof Error ? error.message : String(error),
          isAbortError: error instanceof Error && error.name === 'AbortError',
        },
        'Network error verifying Google token'
      )
      return NextResponse.json({ error: 'Failed to verify Google ID token' }, { status: 500 })
    }

    // SECURITY: verify the token was issued for OUR client (aud) and the
    // email is verified — tokeninfo alone would accept a token minted for the
    // victim's email by any other Google OAuth client (replay/takeover).
    const identity = verifyGoogleIdentity(googleData)
    if (!identity.ok) {
      log.error({ reason: identity.reason }, 'Google identity check failed')
      return NextResponse.json({ error: 'Invalid Google ID token' }, { status: 401 })
    }

    return await completeNativeSignIn({
      provider: 'google',
      providerAccountId: googleData.sub!,
      idToken,
      email: identity.email!,
      // verifyGoogleIdentity has already refused anything Google did not verify.
      emailTrust: 'verified',
      profile: { name: googleData.name, image: googleData.picture },
      meta: { apiVersion: 'v1' as const, authSource: 'google' },
    })
  } catch (error) {
    log.error({ err: error }, 'Google Sign In error')
    return NextResponse.json({ error: 'Google Sign In failed' }, { status: 500 })
  }
}

export const POST = withRateLimitHandlerAsync(googleSignInHandler, authRateLimiter)
