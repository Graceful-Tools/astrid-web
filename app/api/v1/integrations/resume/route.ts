import { type NextRequest, NextResponse } from 'next/server'

import { BRAND } from '@/lib/brand/config'
import { getUnifiedSession } from '@/lib/session-utils'
import { createLogger } from '@/lib/logger'
import { completeIntegrationLink } from '@/lib/sync/link-integration'
import { linkErrorPage, linkFailureMessage, linkSuccessPage } from '@/lib/sync/link-pages'
import { PENDING_LINK_COOKIE, openPendingLink } from '@/lib/sync/pending-link'
import { RESUME_PATH, pendingCookieOptions } from '@/lib/sync/browser-callback'

const log = createLogger('v1.integrations.resume')

/**
 * GET /api/v1/integrations/resume
 *
 * Where a connect link that arrived in a signed-out browser finishes
 * (task 842601f2). The callback parked the grant in an HttpOnly cookie and sent
 * the browser through sign-in; this redeems it against whoever came back.
 *
 * **The signed-in user is the owner.** Nothing in the parked grant names an
 * account — that is the point. The attacker who minted the state delivered the
 * link, so they know the state; they never held this cookie, which was set on
 * the response to the victim's own browser.
 *
 * The cookie is cleared on every outcome, so a grant is redeemable once.
 */
export async function GET(request: NextRequest) {
  const sealed = request.cookies.get(PENDING_LINK_COOKIE)?.value
  const pending = sealed ? openPendingLink(sealed) : null

  let userId: string | undefined
  try {
    userId = (await getUnifiedSession(request))?.user?.id
  } catch {
    userId = undefined
  }

  if (!userId) {
    // Still signed out — either they arrived here directly or abandoned the
    // sign-in. Send them back through it, keeping the grant if there is one.
    return NextResponse.redirect(new URL(`/auth/signin?callbackUrl=${encodeURIComponent(RESUME_PATH)}`, request.url))
  }

  if (!pending) {
    return clearPending(
      linkErrorPage(
        'github',
        `This connect link has expired. Go back to ${BRAND.appName} and tap Connect again.`,
      ),
    )
  }

  const result = await completeIntegrationLink(pending.provider, userId, pending.code, pending.redirectUri)
  if (!result.ok) {
    log.error({ provider: pending.provider, userId, reason: result.reason }, 'Resumed integration link failed')
    return clearPending(linkErrorPage(pending.provider, linkFailureMessage(result.reason)))
  }

  log.info({ provider: pending.provider, userId }, 'Integration link resumed after sign-in')
  return clearPending(linkSuccessPage(pending.provider, result.account))
}

function clearPending(res: NextResponse): NextResponse {
  res.cookies.set(PENDING_LINK_COOKIE, '', { ...pendingCookieOptions(), maxAge: 0 })
  return res
}
