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

import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose'
import { prisma } from '@/lib/prisma'
import { createDefaultListsForUser } from '@/lib/default-lists'
import { withRateLimitHandler, authRateLimiter } from '@/lib/rate-limiter'
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
  })
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error("Missing or invalid 'sub' claim")
  }
  return payload as AppleJWTPayload
}

async function appleSignInHandler(request: NextRequest) {
  try {
    const { identityToken, email, fullName } = await request.json()

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
    const userEmail = email || verifiedPayload.email
    if (!userEmail) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    let existingUser = await prisma.user.findUnique({
      where: { email: userEmail.toLowerCase() },
      include: { accounts: true },
    })

    if (existingUser) {
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
        log.error({ email: userEmail }, 'Apple user ID mismatch for email')
        return NextResponse.json({ error: 'Account verification failed' }, { status: 401 })
      }

      if (fullName && !existingUser.name) {
        existingUser = await prisma.user.update({
          where: { id: existingUser.id },
          data: { name: fullName, emailVerified: new Date() },
          include: { accounts: true },
        })
      }
    } else {
      existingUser = await prisma.user.create({
        data: {
          email: userEmail.toLowerCase(),
          name: fullName || userEmail.split('@')[0],
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

export const POST = withRateLimitHandler(appleSignInHandler, authRateLimiter)
