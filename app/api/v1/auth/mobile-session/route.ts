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
        return NextResponse.json({
          user: {
            id: decoded.id as string,
            email: decoded.email as string,
            name: decoded.name as string | null,
            image: decoded.image as string | null,
          },
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

    return NextResponse.json({
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      },
      meta: META,
    })
  } catch (error) {
    log.error({ err: error }, 'Session validation error')
    return NextResponse.json({ error: 'Session validation failed' }, { status: 500 })
  }
}
