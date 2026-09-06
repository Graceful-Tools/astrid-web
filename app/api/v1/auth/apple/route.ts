/**
 * POST /api/v1/auth/apple
 *
 * Apple Sign In for iOS. Verifies the identity token against Apple's JWKS,
 * upserts the user, links the OAuth account, mints a NextAuth-compatible
 * database session, and sets the session + CSRF cookies. Mirrors POST
 * /api/auth/apple — same behaviour, plus the v1 `meta` envelope.
 *
 * Independent implementation rather than shared handler: failure-domain
 * isolation while iOS migrates from legacy → v1.
 */

import { capabilityGate } from '@/lib/brand/capabilities'
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose'
import { prisma } from '@/lib/prisma'
import { adoptUnverifiedAccount } from '@/lib/auth/adopt-unverified-account'
import { resolveAppleIdentity, appleAllowedAudiences } from '@/lib/auth/apple-identity'
import { createDefaultListsForUser } from '@/lib/default-lists'
import { withRateLimitHandlerAsync, authRateLimiter } from '@/lib/rate-limiter'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.auth.apple')

function generateSecureToken(prefix: string): string {
  return `${prefix}-${randomBytes(32).toString('hex')}`
}

const APPLE_JWKS_URL = new URL('https://appleid.apple.com/auth/keys')
const appleJWKS = createRemoteJWKSet(APPLE_JWKS_URL)

interface AppleJWTPayload extends JWTPayload {
  sub: string
  email?: string
  email_verified?: string | boolean
  is_private_email?: string | boolean
  auth_time?: number
}

async function verifyAppleToken(identityToken: string): Promise<AppleJWTPayload> {
  const { payload } = await jwtVerify(identityToken, appleJWKS, {
    issuer: 'https://appleid.apple.com',
    audience: appleAllowedAudiences(),
  })
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error("Missing or invalid 'sub' claim")
  }
  return payload as AppleJWTPayload
}

async function appleSignInHandler(request: NextRequest) {
  // See the note in the v1 Google route: the brand switch must close this door
  // too, and before the body is read. (Task 3ba0719f.)
  const blocked = capabilityGate('authApple')
  if (blocked) return blocked

  try {
    const { identityToken, fullName } = await request.json()

    if (!identityToken) {
      return NextResponse.json({ error: 'Missing identity token' }, { status: 400 })
    }

    let verifiedPayload: AppleJWTPayload
    try {
      verifiedPayload = await verifyAppleToken(identityToken)
    } catch (error) {
      log.error({ err: error }, 'Apple token verification error')
      return NextResponse.json({ error: 'Invalid identity token' }, { status: 401 })
    }

    const appleUserId = verifiedPayload.sub
    // Identity comes ONLY from the verified token. The body `email` was
    // previously trusted over the claim, which allowed account takeover:
    // an attacker's valid token + a victim's email linked the attacker's
    // Apple id onto the victim's account. Body email is display-only now
    // (and unused); body fullName is fine (Apple provides the name only
    // client-side on first auth).
    const { email: tokenEmail, emailVerified } = resolveAppleIdentity(verifiedPayload)

    // Returning user: the Apple account row is the primary key. This also
    // fixes logins after Apple stops sending the email claim consistently.
    const linkedAccount = await prisma.account.findFirst({
      where: { provider: 'apple', providerAccountId: appleUserId },
    })

    let existingUser =
      linkedAccount
        ? await prisma.user.findUnique({
            where: { id: linkedAccount.userId },
            include: { accounts: true },
          })
        : null

    if (!existingUser) {
      if (!tokenEmail) {
        return NextResponse.json({ error: 'Email is required' }, { status: 400 })
      }
      existingUser = await prisma.user.findUnique({
        where: { email: tokenEmail },
        include: { accounts: true },
      })

      if (existingUser) {
        // Linking onto an EXISTING account requires Apple to affirm the
        // email is verified — otherwise reject rather than merge.
        if (!emailVerified) {
          log.error({ appleUserId }, 'Apple link refused: email not verified by token')
          return NextResponse.json({ error: 'Account verification failed' }, { status: 401 })
        }

        // See app/api/auth/apple/route.ts — Apple has affirmed ownership, the
        // row found by email had proved nothing, and passkey signup creates
        // exactly such unverified rows (task 1a52195f).
        await adoptUnverifiedAccount(prisma, existingUser, 'apple')

        const appleAccount = existingUser.accounts.find(acc => acc.provider === 'apple')
        if (!appleAccount) {
          await prisma.account.create({
            data: {
              userId: existingUser.id,
              type: 'oauth',
              provider: 'apple',
              providerAccountId: appleUserId,
              id_token: identityToken,
            },
          })
        } else if (appleAccount.providerAccountId !== appleUserId) {
          log.error({ appleUserId }, 'Apple user ID mismatch for email')
          return NextResponse.json({ error: 'Account verification failed' }, { status: 401 })
        }
      } else {
        existingUser = await prisma.user.create({
          data: {
            email: tokenEmail,
            name: fullName || tokenEmail.split('@')[0],
            emailVerified: new Date(),
            accounts: {
              create: {
                type: 'oauth',
                provider: 'apple',
                providerAccountId: appleUserId,
                id_token: identityToken,
              },
            },
          },
          include: { accounts: true },
        })
        await createDefaultListsForUser(existingUser.id)
      }
    }

    if (existingUser && fullName && !existingUser.name) {
      existingUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: { name: fullName },
        include: { accounts: true },
      })
    }

    if (!existingUser) {
      throw new Error('Failed to locate or create user for Apple Sign In')
    }

    const session = await prisma.session.create({
      data: {
        userId: existingUser.id,
        sessionToken: generateSecureToken('apple'),
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
      meta: { apiVersion: 'v1' as const, authSource: 'apple' },
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
    log.error({ err: error }, 'Apple Sign In error')
    return NextResponse.json({ error: 'Apple Sign In failed' }, { status: 500 })
  }
}

export const POST = withRateLimitHandlerAsync(appleSignInHandler, authRateLimiter)
