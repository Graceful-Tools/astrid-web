import { encode } from 'next-auth/jwt'

/**
 * A signed-in browser for Playwright, without signing in (AWTD-1039).
 *
 * The app has no password sign-in — Google, Apple and passkeys only — so a test
 * cannot type its way in. The session is a NextAuth JWT (`session.strategy:
 * "jwt"` in lib/auth-config.ts), so a token signed with `NEXTAUTH_SECRET` for a
 * real user row IS a session, indistinguishable to the server from one issued
 * by a real sign-in. `scripts/uitest-account.ts` does the same for the iOS UI
 * suite against production; `scripts/create-e2e-auth-state.ts` uses these
 * helpers against a local test database only.
 *
 * It used to write database `Session` rows instead. Those satisfy the API
 * routes (they fall back to a DB lookup for mobile), but the web UI reads only
 * the JWT, so a browser carrying one was signed out and no signed-in UI check
 * could run.
 */

/** Matches `session.maxAge` in lib/auth-config.ts. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

export interface SessionUser {
  id: string
  email: string | null
  name: string | null
  image: string | null
}

/** The token the `jwt` callback in lib/auth-config.ts writes on a first sign-in. */
export function mintSessionToken(user: SessionUser, secret: string): Promise<string> {
  return encode({
    token: {
      id: user.id,
      sub: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      provider: 'playwright',
    },
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

/** NextAuth prefixes the cookie with `__Secure-` exactly when the origin is HTTPS. */
export function sessionCookieName(baseURL: string): string {
  return new URL(baseURL).protocol === 'https:'
    ? '__Secure-next-auth.session-token'
    : 'next-auth.session-token'
}

/** A Playwright storage state holding just the session cookie for `baseURL`. */
export function sessionStorageState(token: string, baseURL: string) {
  const url = new URL(baseURL)
  return {
    cookies: [{
      name: sessionCookieName(baseURL),
      value: token,
      domain: url.hostname,
      path: '/',
      expires: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
      httpOnly: true,
      secure: url.protocol === 'https:',
      sameSite: 'Lax' as const,
    }],
    origins: [],
  }
}
