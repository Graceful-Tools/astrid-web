import { type NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { isAppSchemeRedirect, appCompletedState } from '@/lib/sync/app-completed-link'
import { mintOAuthState } from '@/lib/sync/oauth-state'
import { googleAuthorizeURL, googleSyncConfigured } from '@/lib/sync/google'

/**
 * GET /api/v1/integrations/google/authorize[?redirectUri=astrid://…]
 *
 * Without `redirectUri`: the browser-completed flow (HMAC state; offline
 * access for refresh). With an app-scheme `redirectUri`: the app-completed
 * flow, where the code goes to the app and the state names nobody
 * (task 842601f2 — see lib/sync/app-completed-link.ts).
 */
export const GET = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations.google', capability: 'syncGoogleTasks' },
  async (req: NextRequest, auth) => {
    if (!googleSyncConfigured()) {
      return NextResponse.json({ error: 'Google Tasks sync is not configured on this server' }, { status: 503 })
    }

    const url = new URL(req.url)
    const requested = url.searchParams.get('redirectUri')
    if (requested && !isAppSchemeRedirect(requested)) {
      return NextResponse.json({ error: 'redirectUri must be this app’s URL scheme' }, { status: 400 })
    }

    const redirectUri = requested ?? `${url.origin}/api/v1/integrations/google/callback`
    const state = requested ? appCompletedState() : mintOAuthState(auth.userId, 'google')

    return NextResponse.json({ url: googleAuthorizeURL(state, redirectUri) })
  }
)
