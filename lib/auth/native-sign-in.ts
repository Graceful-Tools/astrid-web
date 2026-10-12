/**
 * The tail every native (iOS) sign-in route shares: apply the linking rule,
 * then hand back a session (AWTD-1104, spec §6.3 and §6.5).
 *
 * The four routes — /api/auth/{apple,google} and /api/v1/auth/{apple,google} —
 * used to each find, link, adopt and create the user themselves, and each mint
 * a database `Session` row. The routes now only verify the provider's token;
 * the rest is here.
 *
 * The session is the NextAuth JWT that passkey and the desktop hand-off already
 * issue, so every reader decodes one format. Database sessions minted before
 * this keep working until they expire: mobile-session and the API middleware
 * still fall back to the `Session` table.
 *
 * Cookies, which iOS stores from `Set-Cookie`:
 *   - `next-auth.session-token`, the name these routes have always used, so a
 *     client that looks for it by name finds it, and the JWT replaces any old
 *     database token stored under it;
 *   - in production also `__Secure-next-auth.session-token`, the name NextAuth
 *     reads, so `getServerSession` accepts the session directly.
 * The body states the token, its expiry and NextAuth's cookie name too, as
 * /api/v1/auth/desktop/exchange does. All of it is additive for old clients.
 */

import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { signInWithVerifiedIdentity, type EmailTrust } from '@/lib/auth/federated-identity-linking'
import {
  SESSION_COOKIE_NAME_PLAIN,
  SESSION_COOKIE_NAME_SECURE,
  sessionCookieNameFor,
} from '@/lib/auth/desktop-handoff'
import { renewSessionToken, SESSION_MAX_AGE_SECONDS } from '@/lib/mobile-session-renewal'

export interface NativeSignIn {
  provider: 'apple' | 'google'
  /** The provider's stable subject: Google `sub`, Apple `sub`. */
  providerAccountId: string
  /** The provider's ID token, kept on the account row as the routes always have. */
  idToken: string
  email: string | null
  emailTrust: EmailTrust
  profile: { name?: string | null; image?: string | null }
  /** The v1 envelope, when the caller is a v1 route. */
  meta?: Record<string, unknown>
}

export async function completeNativeSignIn(signIn: NativeSignIn): Promise<NextResponse> {
  const result = await signInWithVerifiedIdentity({
    provider: signIn.provider,
    account: {
      provider: signIn.provider,
      type: 'oauth',
      providerAccountId: signIn.providerAccountId,
      id_token: signIn.idToken,
    },
    email: signIn.email,
    emailTrust: signIn.emailTrust,
    profile: signIn.profile,
  })

  if (!result.ok) {
    return result.reason === 'missing-email'
      ? NextResponse.json({ error: 'Email is required' }, { status: 400 })
      : NextResponse.json({ error: 'Account verification failed' }, { status: 401 })
  }

  const { user } = result
  const isProduction = process.env.NODE_ENV === 'production'

  const { token, expiresAt } = await renewSessionToken(
    { sub: user.id, id: user.id, email: user.email, name: user.name, image: user.image, provider: signIn.provider },
    process.env.NEXTAUTH_SECRET!,
  )

  const response = NextResponse.json({
    user,
    sessionToken: token,
    expiresAt: expiresAt.toISOString(),
    sessionCookieName: sessionCookieNameFor(isProduction),
    ...(signIn.meta ? { meta: signIn.meta } : {}),
  })

  const cookie = {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax' as const,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: '/',
  }
  response.cookies.set(SESSION_COOKIE_NAME_PLAIN, token, cookie)
  if (isProduction) response.cookies.set(SESSION_COOKIE_NAME_SECURE, token, cookie)
  // CSRF token (required for NextAuth POST requests), as these routes always set.
  response.cookies.set('next-auth.csrf-token', `csrf-${randomBytes(32).toString('hex')}`, cookie)

  return response
}
