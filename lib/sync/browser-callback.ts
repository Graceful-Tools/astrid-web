/**
 * The shared tail of the three browser-completed connect callbacks
 * (task 842601f2).
 *
 * ## The rule these callbacks now follow
 *
 * The provider token is filed on the account the BROWSER is signed in as —
 * never on the account the `state` names. The state names whoever started the
 * flow, and an attacker can start one for their own account and hand the victim
 * the provider's authorize URL; deciding the owner from it is the vulnerability.
 *
 * That leaves three cases, and each callback used to answer only the first two:
 *
 * - **Signed in as the account the state names.** The ordinary case. Complete.
 * - **Signed in as somebody else.** Somebody else's connect link. Refuse.
 * - **Signed out.** Nothing here answers who is sitting there — so do not
 *   spend the grant. Park it (lib/sync/pending-link.ts) and send the browser
 *   through sign-in; whoever comes back gets the token.
 *
 * The third case is why this is worth a round trip rather than a one-line
 * "require a session". Refusing outright would break Connect for anyone who has
 * never signed in to the web — which on iOS is most people, because the app
 * authenticates natively. `ASWebAuthenticationSession` runs with
 * `prefersEphemeralWebBrowserSession = false` (astrid-ios,
 * OAuthWebConnector.swift), so it shares Safari's cookie jar: the sign-in it is
 * sent through sticks, and the round trip happens once rather than every time.
 */

import { type NextRequest, NextResponse } from 'next/server'

import { getUnifiedSession } from '@/lib/session-utils'
import { createLogger } from '@/lib/logger'
import { BRAND } from '@/lib/brand/config'
import { completeIntegrationLink } from '@/lib/sync/link-integration'
import { linkErrorPage, linkFailureMessage, linkSuccessPage } from '@/lib/sync/link-pages'
import { PENDING_LINK_COOKIE, sealPendingLink } from '@/lib/sync/pending-link'
import type { OAuthStateProvider } from '@/lib/sync/oauth-state'

const log = createLogger('integrations.browser-callback')

export const RESUME_PATH = '/api/v1/integrations/resume'

/** Fifteen minutes, matching the seal's own TTL. */
const PENDING_COOKIE_MAX_AGE = 15 * 60

export function pendingCookieOptions() {
  return {
    httpOnly: true,
    // Lax, not Strict: the browser arrives back here as a top-level navigation
    // from the sign-in page, which Strict would strip the cookie from.
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PENDING_COOKIE_MAX_AGE,
  }
}

/**
 * @param stateUserId who the (verified) state says started the flow — used only
 * to detect that a different account is sitting here, never as the owner.
 * @param redirectUri echoed to the provider on the exchange when it requires one.
 */
export async function finishBrowserConnect(
  request: NextRequest,
  provider: OAuthStateProvider,
  code: string,
  stateUserId: string,
  redirectUri?: string,
): Promise<NextResponse> {
  let sessionUserId: string | undefined
  try {
    sessionUserId = (await getUnifiedSession(request))?.user?.id
  } catch {
    // A broken session lookup must not decide the owner by falling back to the
    // state. Treat it as signed out and let the sign-in round trip settle it.
    sessionUserId = undefined
  }

  if (sessionUserId && sessionUserId !== stateUserId) {
    log.error(
      { provider, stateUserId, sessionUserId },
      'Refusing integration callback: the signed-in browser is not the account the state names',
    )
    return linkErrorPage(
      provider,
      `This connect link was started from a different ${BRAND.appName} account. Open ${BRAND.appName} and tap Connect again.`,
    )
  }

  if (!sessionUserId) {
    log.info({ provider }, 'Parking an integration grant: nobody is signed in to file it on')
    const res = NextResponse.redirect(
      new URL(`/auth/signin?callbackUrl=${encodeURIComponent(RESUME_PATH)}`, request.url),
    )
    res.cookies.set(PENDING_LINK_COOKIE, sealPendingLink({ provider, code, redirectUri }), pendingCookieOptions())
    return res
  }

  const result = await completeIntegrationLink(provider, sessionUserId, code, redirectUri)
  return result.ok
    ? linkSuccessPage(provider, result.account)
    : linkErrorPage(provider, linkFailureMessage(result.reason))
}
