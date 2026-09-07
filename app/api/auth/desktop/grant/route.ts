/**
 * POST /api/auth/desktop/grant
 *
 * Called from /signin/desktop by a browser that is already signed in. Mints a
 * one-time PKCE code for a native desktop app and returns the URL that wakes
 * it.
 *
 * The code is minted for the *session* user and nothing in the body can change
 * that — otherwise this endpoint would be an account-takeover primitive: sign
 * in as anyone, ask for a code naming someone else, redeem it in the app.
 *
 * Lives under /api/auth rather than /api/v1 because its caller is the web page,
 * not the native client. The half the app calls is
 * /api/v1/auth/desktop/exchange.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { validateGrantRequest, buildDesktopCallbackUrl } from '@/lib/auth/desktop-handoff'
import { createDesktopGrant } from '@/lib/auth/desktop-grant-store'
import { desktopHandoffRateLimiter, withRateLimitHandlerAsync } from '@/lib/rate-limiter'
import { createLogger } from '@/lib/logger'

const log = createLogger('auth.desktop.grant')

async function grantHandler(request: NextRequest) {
  try {
    const session = await getUnifiedSession(request)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
    }

    const body = await request.json().catch(() => null)
    const validated = validateGrantRequest(body)
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 })
    }

    const { client, state, codeChallenge } = validated.value

    const code = await createDesktopGrant({
      userId: session.user.id,
      client,
      codeChallenge,
    })

    return NextResponse.json({
      redirectUrl: buildDesktopCallbackUrl(client, { code, state }),
    })
  } catch (error) {
    log.error({ err: error }, 'Desktop grant failed')
    return NextResponse.json({ error: 'Could not start the hand-off' }, { status: 500 })
  }
}

export const POST = withRateLimitHandlerAsync(grantHandler, desktopHandoffRateLimiter)
