/**
 * GET /api/v1/auth/mobile-session
 *
 * Validates the iOS session cookie. Tries the JWT (passkey-issued, NextAuth
 * JWT strategy) path first, then falls back to the database session
 * (Apple/Google mobile sign-in). Mirrors GET /api/auth/mobile-session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decode } from 'next-auth/jwt'
import { createLogger } from '@/lib/logger'
import {
  shouldRenewSession,
  renewSessionToken,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/mobile-session-renewal'

const log = createLogger('v1.auth.mobile-session')

const META = { apiVersion: 'v1' as const, authSource: 'cookie' }

export async function GET(request: NextRequest) {
  try {
    const cookies = request.cookies
    const sessionCookie =
      cookies.get('next-auth.session-token') ||
      cookies.get('__Secure-next-auth.session-token')

    if (!sessionCookie) {
      return NextResponse.json({ error: 'No session found' }, { status: 401 })
    }

    try {
      const decoded = await decode({
        token: sessionCookie.value,
        secret: process.env.NEXTAUTH_SECRET!,
      })

      if (decoded && decoded.id && typeof decoded.exp === 'number') {
        const now = Math.floor(Date.now() / 1000)
        if ((decoded.exp as number) < now) {
          return NextResponse.json({ error: 'Session expired' }, { status: 401 })
        }

        // Slide the window, the way the web already does. Web clients get this
        // free from NextAuth's own session endpoint (default updateAge 24h);
        // mobile calls only this route, so without it a mobile session died 30
        // days after sign-in however much the app was used. (Task 1e0eddcb.)
        //
        // Returned in the BODY rather than as a Set-Cookie: mobile clients keep
        // the cookie themselves, and an explicit field is honest about the fact
        // that this call can hand back a new credential.
        let renewed: { token: string; expiresAt: Date } | null = null
        if (shouldRenewSession(decoded.exp as number, now)) {
          try {
            renewed = await renewSessionToken(
              // `decoded.id` was checked above, which is exactly the
              // precondition RenewableClaims encodes.
              { ...decoded, id: decoded.id as string },
              process.env.NEXTAUTH_SECRET!,
              now,
            )
          } catch (renewError) {
            // A failed renewal must never turn a valid session into a 401 —
            // the caller is still signed in, just not extended this time.
            log.error({ err: renewError }, 'Session renewal failed; serving without renewal')
          }
        }

        return NextResponse.json({
          user: {
            id: decoded.id as string,
            email: decoded.email as string,
            name: decoded.name as string | null,
            image: decoded.image as string | null,
          },
          ...(renewed
            ? { sessionToken: renewed.token, expiresAt: renewed.expiresAt.toISOString() }
            : {}),
          meta: META,
        })
      }
    } catch {
      // JWT decode failed — fall through to database session
    }

    const session = await prisma.session.findUnique({
      where: { sessionToken: sessionCookie.value },
      include: { user: true },
    })

    if (!session) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }

    if (session.expires < new Date()) {
      await prisma.session.delete({ where: { id: session.id } })
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }

    // Same sliding window for the database-session path (Apple/Google mobile
    // sign-in), which had the same absolute cap. The token itself does not
    // change here — only the row's expiry — so there is nothing new for the
    // client to store, but `expiresAt` is reported for symmetry.
    let dbExpires = session.expires
    const nowSeconds = Math.floor(Date.now() / 1000)
    if (shouldRenewSession(Math.floor(session.expires.getTime() / 1000), nowSeconds)) {
      try {
        const extended = new Date((nowSeconds + SESSION_MAX_AGE_SECONDS) * 1000)
        await prisma.session.update({
          where: { id: session.id },
          data: { expires: extended },
        })
        dbExpires = extended
      } catch (renewError) {
        log.error({ err: renewError }, 'Database session extension failed; serving without renewal')
      }
    }

    return NextResponse.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      },
      expiresAt: dbExpires.toISOString(),
      meta: META,
    })
  } catch (error) {
    log.error({ err: error }, 'Session validation error')
    return NextResponse.json({ error: 'Session validation failed' }, { status: 500 })
  }
}
