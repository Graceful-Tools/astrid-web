/**
 * POST /api/v1/auth/google
 *
 * Google Sign In for iOS. Verifies the ID token via Google's tokeninfo
 * endpoint, upserts the user, links the OAuth account, mints a NextAuth-
 * compatible database session, and sets the session + CSRF cookies.
 * Mirrors POST /api/auth/google — same behaviour, plus the v1 `meta`
 * envelope.
 */

import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { prisma } from '@/lib/prisma'
import { adoptUnverifiedAccount } from '@/lib/auth/adopt-unverified-account'
import { verifyGoogleIdentity } from "@/lib/auth/google-identity"
import { createDefaultListsForUser } from '@/lib/default-lists'
import { withRateLimitHandlerAsync, authRateLimiter } from '@/lib/rate-limiter'
import { safeResponseJson } from '@/lib/safe-parse'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.auth.google')

function generateSecureToken(prefix: string): string {
  return `${prefix}-${randomBytes(32).toString('hex')}`
}

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

    const userEmail = identity.email!
    const googleUserId = googleData.sub!
    const name = googleData.name || userEmail.split('@')[0]
    const picture = googleData.picture

    let existingUser = await prisma.user.findUnique({
      where: { email: userEmail.toLowerCase() },
      include: { accounts: true },
    })

    if (existingUser) {
      // See app/api/auth/google/route.ts — a row found by email is not proof of
      // ownership, and passkey signup creates unverified rows for any address
      // (task 1a52195f).
      await adoptUnverifiedAccount(prisma, existingUser, 'google')

      const googleAccount = existingUser.accounts.find(acc => acc.provider === 'google')
      if (!googleAccount) {
        await prisma.account.create({
          data: {
            userId: existingUser.id,
            type: 'oauth',
            provider: 'google',
            providerAccountId: googleUserId,
            id_token: idToken,
          },
        })
      }

      existingUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          name: existingUser.name || name,
          image: existingUser.image || picture,
          emailVerified: new Date(),
        },
        include: { accounts: true },
      })
    } else {
      existingUser = await prisma.user.create({
        data: {
          email: userEmail.toLowerCase(),
          name,
          image: picture,
          emailVerified: new Date(),
          accounts: {
            create: {
              type: 'oauth',
              provider: 'google',
              providerAccountId: googleUserId,
              id_token: idToken,
            },
          },
        },
        include: { accounts: true },
      })
      await createDefaultListsForUser(existingUser.id)
    }

    if (!existingUser) {
      throw new Error('Failed to locate or create user for Google Sign In')
    }

    const session = await prisma.session.create({
      data: {
        userId: existingUser.id,
        sessionToken: generateSecureToken('google'),
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    })

    const csrfToken = generateSecureToken('csrf')

    const response = NextResponse.json({
      user: {
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        image: existingUser.image,
      },
      meta: { apiVersion: 'v1' as const, authSource: 'google' },
    })

    response.cookies.set('next-auth.session-token', session.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })
    response.cookies.set('next-auth.csrf-token', csrfToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
      path: '/',
    })

    return response
  } catch (error) {
    log.error({ err: error }, 'Google Sign In error')
    return NextResponse.json({ error: 'Google Sign In failed' }, { status: 500 })
  }
}

export const POST = withRateLimitHandlerAsync(googleSignInHandler, authRateLimiter)
