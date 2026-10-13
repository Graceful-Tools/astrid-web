/**
 * Whether this deployment uses `__Secure-`-prefixed NextAuth cookies, and the
 * session cookie name that follows (AWTD-1248).
 *
 * NextAuth asks this question in two places and both answer it from the URL
 * scheme, never from `NODE_ENV`:
 *   - `getToken()` — node_modules/next-auth/jwt/index.js:65
 *   - the cookie defaults `getServerSession` uses when `authOptions.cookies`
 *     leaves a name unset — node_modules/next-auth/core/init.js:60
 *
 * `lib/auth-config.ts` used to override the names on `NODE_ENV === "production"`
 * alone, which is a different question. A production build served over plain
 * http — CI's `next start`, or a local production build — then had
 * `getServerSession` looking for `__Secure-next-auth.session-token` while
 * `getToken` looked for `next-auth.session-token`. Routes reached through
 * `withAuth` authenticated and the 122 that call `getUnifiedSession()` with no
 * request returned 401, which is how this was found: `authenticated-critical`
 * saw a list PUT correctly refused as 403/404 and the upload next to it 401.
 */

import { BRAND } from '@/lib/brand/config'

type AuthEnv = Pick<NodeJS.ProcessEnv, 'NEXTAUTH_URL' | 'VERCEL'>

/**
 * The same rule `getToken()` applies. An unset `NEXTAUTH_URL` falls back to
 * "are we on Vercel", so production keeps secure cookies even if the variable
 * goes missing there — reading it as plain http would re-prefix every cookie
 * and sign out every signed-in user at once.
 */
export function usesSecureAuthCookies(env: AuthEnv = process.env): boolean {
  return env.NEXTAUTH_URL?.startsWith('https://') ?? Boolean(env.VERCEL)
}

/** The session cookie name both halves of NextAuth will look for. */
export function authSessionCookieName(env: AuthEnv = process.env): string {
  return usesSecureAuthCookies(env)
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token'
}

/** Matches `session.maxAge` in lib/auth-config.ts. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

/**
 * The cookie a route writing a session by hand must set for
 * `getServerSession` and `getToken` to find it afterwards.
 *
 * The passkey verify routes used to decide this themselves, from a broader
 * "are we production" signal than the one the readers use — so a production
 * build over plain http, or a dev server with a brand-domain NEXTAUTH_URL,
 * signed a user in under a name nothing would look for (AWTD-1248). They also
 * had the block twice, character for character.
 */
export function authSessionCookie(env: AuthEnv = process.env): {
  name: string
  options: {
    httpOnly: true
    secure: boolean
    sameSite: 'lax'
    path: '/'
    maxAge: number
    domain?: string
  }
} {
  const secure = usesSecureAuthCookies(env)
  return {
    name: authSessionCookieName(env),
    options: {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      // Scoped to the brand domain and its subdomains (leading dot), so a
      // session started on the apex is valid on preview subdomains. Task
      // 97208a72. A `__Secure-` cookie is the only one that may carry it here:
      // over plain http the browser would reject the pair outright.
      ...(secure ? { domain: `.${BRAND.domain}` } : {}),
    },
  }
}
