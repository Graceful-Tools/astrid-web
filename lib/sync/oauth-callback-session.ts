/**
 * Cross-check an integration OAuth callback against the browser's own session.
 *
 * The linking flow (task 842601f2) mints an HMAC-signed `state` carrying the
 * INITIATOR's user id and nothing else, and the callback trusts it. So an
 * attacker could call /authorize for their own account, take the state, and
 * send the victim the provider's authorize URL carrying it. The victim
 * approves at GitHub or Google, and the callback files the VICTIM's
 * repo-scoped token onto the ATTACKER's account.
 *
 * The callback runs in a browser, and a user of this product is usually signed
 * in there. When they are, the browser answers the question the state cannot:
 * who is actually sitting here. If that disagrees with the state, the flow was
 * started by somebody else and must not complete.
 *
 * This is a partial defence and is meant as one. A victim who is signed OUT in
 * that browser still falls through to the old behaviour. Closing that requires
 * demanding a browser session for every link, which changes the mobile connect
 * flow, so it is Jon's call rather than a silent behaviour change here.
 */

import type { NextRequest } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('integrations.oauth-callback-session')

/**
 * @returns true when the callback must be refused because the signed-in
 * browser belongs to somebody other than the account the state names.
 */
export async function callbackSessionConflicts(
  request: NextRequest,
  stateUserId: string,
  provider: string,
): Promise<boolean> {
  let sessionUserId: string | undefined
  try {
    const session = await getUnifiedSession(request)
    sessionUserId = session?.user?.id
  } catch {
    // A broken session lookup must not break a legitimate connect.
    return false
  }

  if (!sessionUserId || sessionUserId === stateUserId) {
    return false
  }

  log.error(
    { provider, stateUserId, sessionUserId },
    'Refusing integration callback: the signed-in browser is not the account the state names',
  )
  return true
}
