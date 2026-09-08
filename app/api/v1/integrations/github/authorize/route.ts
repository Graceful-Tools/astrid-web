import { type NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { isAppSchemeRedirect, appCompletedState } from '@/lib/sync/app-completed-link'
import { githubSyncConfigured, mintOAuthState } from '@/lib/sync/github'

/**
 * GET /api/v1/integrations/github/authorize[?redirectUri=astrid://…]
 *
 * Without `redirectUri`: the browser-completed flow. State is HMAC-signed with
 * the caller's user id so the browser callback can identify them without a web
 * session — and is therefore forgeable by whoever minted it (task 842601f2).
 *
 * With an app-scheme `redirectUri`: the app-completed flow. GitHub returns the
 * code to the app, which posts it to /complete authenticated, so the state
 * names nobody and carries no authority. See lib/sync/app-completed-link.ts.
 */
export const GET = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations.github', capability: 'syncGithubIssues' },
  async (req: NextRequest, auth) => {
    if (!githubSyncConfigured()) {
      return NextResponse.json({ error: 'GitHub sync is not configured on this server' }, { status: 503 })
    }

    const requested = new URL(req.url).searchParams.get('redirectUri')
    if (requested && !isAppSchemeRedirect(requested)) {
      return NextResponse.json({ error: 'redirectUri must be this app’s URL scheme' }, { status: 400 })
    }

    const params = new URLSearchParams({
      client_id: process.env.GITHUB_SYNC_CLIENT_ID!,
      scope: 'repo',
      state: requested ? appCompletedState() : mintOAuthState(auth.userId),
    })
    if (requested) params.set('redirect_uri', requested)

    return NextResponse.json({ url: `https://github.com/login/oauth/authorize?${params}` })
  }
)
