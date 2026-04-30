/**
 * POST /api/v1/users/me/verify-email
 *
 * Multi-action endpoint:
 * - `?token=<x>` (no auth required) — verify a token from an email link
 * - `?action=send` — send verification for the current pending email
 * - `?action=resend` — resend the most recent verification
 * - `?action=cancel` — cancel a pending email change
 *
 * Mirrors POST /api/account/verify-email.
 *
 * Note: token verification is unauthenticated (the token IS the auth)
 * and is handled by a separate route below /unauthenticated. The
 * authenticated actions go through withAuth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import {
  verifyEmailToken,
  sendEmailVerification,
  resendVerificationEmail,
  cancelEmailChange,
} from '@/lib/email-verification'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.verify-email')

/**
 * Public route — token verification doesn't require existing auth (the
 * token replaces it). If a token is present we handle it before withAuth
 * even runs by short-circuiting with a separate POST handler.
 */
async function handleTokenVerification(token: string) {
  const result = await verifyEmailToken(token)
  return NextResponse.json(result, { status: result.success ? 200 : 400 })
}

/** Public-or-authenticated entrypoint. Routes by query param. */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (token) {
      return handleTokenVerification(token)
    }

    // Fall through to authenticated handler for action=send/resend/cancel
    return authenticatedAction(request, undefined)
  } catch (error) {
    log.error({ err: error }, 'Error in email verification')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const authenticatedAction = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.verify-email' },
  async (req, auth) => {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')

    switch (action) {
      case 'resend': {
        const r = await resendVerificationEmail(auth.userId)
        return NextResponse.json(r, { status: r.success ? 200 : 400 })
      }
      case 'cancel': {
        const r = await cancelEmailChange(auth.userId)
        return NextResponse.json(r, { status: r.success ? 200 : 400 })
      }
      case 'send': {
        const r = await sendEmailVerification(auth.userId)
        return NextResponse.json(r, { status: r.success ? 200 : 400 })
      }
      default:
        return NextResponse.json(
          { error: "Invalid action. Use 'resend', 'cancel', or 'send'" },
          { status: 400 }
        )
    }
  }
)
