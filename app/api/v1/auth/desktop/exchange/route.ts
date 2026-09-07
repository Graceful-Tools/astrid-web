/**
 * POST /api/v1/auth/desktop/exchange
 *
 * The native half of desktop hand-off sign-in: a one-time code plus the PKCE
 * verifier that proves the caller is the app instance that started the flow,
 * exchanged for a session token.
 *
 * Unauthenticated by necessity — the app has no session yet, which is the
 * whole point — so the code is the credential and every guard lives in
 * `redeemDesktopGrant`: hashed lookup, atomic single-use claim, expiry, and
 * S256 verification.
 *
 * Two deliberate choices in the response:
 *   - the token is returned in the BODY, never as a Set-Cookie. The caller
 *     stores the credential itself; setting a cookie would additionally sign in
 *     whatever HTTP stack happened to make the call.
 *   - `sessionCookieName` is stated rather than left to the client to guess.
 *     A native client holds a whole `Cookie` header and must choose a name
 *     before it has ever seen a server cookie.
 */

import { NextRequest, NextResponse } from 'next/server'
import { desktopClientFor, sessionCookieNameFor } from '@/lib/auth/desktop-handoff'
import { redeemDesktopGrant } from '@/lib/auth/desktop-grant-store'
import { renewSessionToken } from '@/lib/mobile-session-renewal'
import { desktopHandoffRateLimiter, withRateLimitHandlerAsync } from '@/lib/rate-limiter'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.auth.desktop.exchange')

const META = { apiVersion: 'v1' as const, authSource: 'desktop-handoff' }

/**
 * One answer for every rejected redemption.
 *
 * Telling a caller whether the code or the verifier was wrong tells an
 * interceptor which half it already holds.
 */
const REDEMPTION_FAILED = { error: 'Invalid or expired code' }

async function exchangeHandler(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const { code, codeVerifier } = body as Record<string, unknown>
    const client = desktopClientFor((body as Record<string, unknown>).client)

    if (!client || typeof code !== 'string' || !code || typeof codeVerifier !== 'string') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const redeemed = await redeemDesktopGrant({ code, client, codeVerifier })
    if (!redeemed.ok) {
      return redeemed.reason === 'account-missing'
        ? NextResponse.json({ error: 'Account no longer exists' }, { status: 401 })
        : NextResponse.json(REDEMPTION_FAILED, { status: 400 })
    }

    const { user } = redeemed

    const { token, expiresAt } = await renewSessionToken(
      {
        sub: user.id,
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        provider: 'desktop-handoff',
      },
      process.env.NEXTAUTH_SECRET!,
    )

    return NextResponse.json({
      sessionToken: token,
      expiresAt: expiresAt.toISOString(),
      sessionCookieName: sessionCookieNameFor(process.env.NODE_ENV === 'production'),
      user,
      meta: META,
    })
  } catch (error) {
    log.error({ err: error }, 'Desktop exchange failed')
    return NextResponse.json({ error: 'Could not complete sign-in' }, { status: 500 })
  }
}

export const POST = withRateLimitHandlerAsync(exchangeHandler, desktopHandoffRateLimiter)
