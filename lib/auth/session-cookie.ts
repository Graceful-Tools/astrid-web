/**
 * Who a raw session-cookie value belongs to, for callers that read the cookie
 * themselves rather than through `getServerSession` (AWTD-1104).
 *
 * `getServerSession` reads only the cookie name NextAuth issues for the
 * environment — `__Secure-next-auth.session-token` in production. The native
 * sign-in routes have always set `next-auth.session-token`, and iOS sends what
 * it was given, so the API's fallback reads either name. Two formats can sit
 * under it:
 *   - the NextAuth JWT, which every sign-in path issues now;
 *   - a database `Session` row token, which the native routes minted before
 *     AWTD-1104. Accepted until those rows expire (30 days), then this branch
 *     and the `Session` lookups elsewhere can go (spec §6.5).
 */

import { decode } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'

export interface CookieSession {
  user: { id: string; email: string; name: string | null; image: string | null }
  expires: string
}

export async function sessionFromCookieValue(value: string): Promise<CookieSession | null> {
  try {
    const claims = await decode({ token: value, secret: process.env.NEXTAUTH_SECRET! })
    if (claims && typeof claims.id === 'string' && typeof claims.exp === 'number') {
      if (claims.exp * 1000 <= Date.now()) return null
      return {
        user: {
          id: claims.id,
          email: claims.email as string,
          name: (claims.name as string | null) ?? null,
          image: (claims.image as string | null) ?? null,
        },
        expires: new Date(claims.exp * 1000).toISOString(),
      }
    }
  } catch {
    // Not a JWT: a database session token, below.
  }

  const dbSession = await prisma.session.findUnique({
    where: { sessionToken: value },
    include: { user: true },
  })
  if (!dbSession || dbSession.expires <= new Date()) return null
  return {
    user: {
      id: dbSession.user.id,
      email: dbSession.user.email,
      name: dbSession.user.name,
      image: dbSession.user.image,
    },
    expires: dbSession.expires.toISOString(),
  }
}
