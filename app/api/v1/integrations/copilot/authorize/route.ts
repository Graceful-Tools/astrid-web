import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import {
  copilotIntegrationGate,
  copilotOAuthConfigured,
  mintCopilotOAuthState,
} from '@/lib/copilot/oauth'

/**
 * GET /api/v1/integrations/copilot/authorize
 * Returns the GitHub OAuth URL to connect the user's Copilot subscription.
 * State is HMAC-signed (provider-tagged) so the browser callback can identify
 * the user without a web session. See docs/COPILOT_SDK_INTEGRATION_PLAN.md.
 */
export const GET = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations.copilot' },
  async (_req, auth) => {
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
    const state = mintCopilotOAuthState(auth.userId)
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_COPILOT_CLIENT_ID!,
      state,
    })
    return NextResponse.json({ url: `https://github.com/login/oauth/authorize?${params}` })
  },
)
