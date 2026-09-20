/**
 * DELETE /api/v1/auth/signout
 *
 * iOS-friendly signout. Deletes the database session row tied to the
 * supplied session cookie and revokes any "Mobile App Token" rows still
 * around from builds that minted one (the mint endpoint is gone; the revoke
 * stays until those tokens have all expired). NextAuth's [...nextauth]
 * catch-all handles the web signout via POST; iOS prefers a direct DELETE.
 *
 * Idempotent: returns 200 even if there was no session to delete, so the
 * client cleanup path on iOS can fire-and-forget without sweating the
 * response.
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sessionRateLimiter, withRateLimitHandlerAsync } from "@/lib/rate-limiter"
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.auth.signout')

const META = { apiVersion: 'v1' as const, authSource: 'cookie' }

async function signoutHandler(request: NextRequest) {
  try {
    const sessionCookie =
      request.cookies.get('next-auth.session-token') ||
      request.cookies.get('__Secure-next-auth.session-token')

    if (!sessionCookie) {
      return NextResponse.json({ success: true, meta: META })
    }

    const session = await prisma.session.findUnique({
      where: { sessionToken: sessionCookie.value },
      select: { id: true, userId: true },
    })

    if (session) {
      await prisma.$transaction([
        prisma.session.delete({ where: { id: session.id } }),
        prisma.mCPToken.updateMany({
          where: {
            userId: session.userId,
            description: 'Mobile App Token',
            isActive: true,
          },
          data: { isActive: false },
        }),
      ])
    }

    const response = NextResponse.json({ success: true, meta: META })
    response.cookies.delete('next-auth.session-token')
    response.cookies.delete('__Secure-next-auth.session-token')
    response.cookies.delete('next-auth.csrf-token')
    return response
  } catch (error) {
    log.error({ err: error }, 'Sign out error')
    return NextResponse.json({ success: true, meta: META })
  }
}

export const DELETE = withRateLimitHandlerAsync(signoutHandler, sessionRateLimiter)
