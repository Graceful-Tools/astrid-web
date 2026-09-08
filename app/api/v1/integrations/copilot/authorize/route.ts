import { type NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { isAppSchemeRedirect, appCompletedState } from '@/lib/sync/app-completed-link'
import {
  copilotIntegrationGate,
  copilotOAuthConfigured,
  mintCopilotOAuthState,
} from '@/lib/copilot/oauth'

/**
 * GET /api/v1/integrations/copilot/authorize[?redirectUri=astrid://…]
 *
 * Returns the GitHub OAuth URL to connect the user's Copilot subscription.
 * Without `redirectUri`, state is HMAC-signed (provider-tagged) so the browser
 * callback can identify the user without a web session. With an app-scheme
 * `redirectUri`, the code goes to the app and the state names nobody
 * (task 842601f2). See docs/COPILOT_SDK_INTEGRATION_PLAN.md.
 */
export const GET = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations.copilot' },
  async (req: NextRequest, auth) => {
    // A brand without the copilot agent has no Copilot integration to
    // authorize against (task 229c175c).
    const gateBlocked = copilotIntegrationGate()
    if (gateBlocked) return gateBlocked

    if (!copilotOAuthConfigured()) {
      return NextResponse.json(
        { error: 'GitHub Copilot is not configured on this server' },
        { status: 503 },
      )
    }

    const requested = new URL(req.url).searchParams.get('redirectUri')
    if (requested && !isAppSchemeRedirect(requested)) {
      return NextResponse.json({ error: 'redirectUri must be this app’s URL scheme' }, { status: 400 })
    }

    const params = new URLSearchParams({
      client_id: process.env.GITHUB_COPILOT_CLIENT_ID!,
      state: requested ? appCompletedState() : mintCopilotOAuthState(auth.userId),
    })
    if (requested) params.set('redirect_uri', requested)

    return NextResponse.json({ url: `https://github.com/login/oauth/authorize?${params}` })
  },
)
