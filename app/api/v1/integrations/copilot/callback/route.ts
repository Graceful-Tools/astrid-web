import { BRAND } from '@/lib/brand/config'
import { type NextRequest, NextResponse } from 'next/server'
import { copilotIntegrationGate, copilotOAuthConfigured, verifyCopilotOAuthState } from '@/lib/copilot/oauth'
import { finishBrowserConnect } from '@/lib/sync/browser-callback'
import { linkErrorPage } from '@/lib/sync/link-pages'

/**
 * GET /api/v1/integrations/copilot/callback?code&state
 * Browser redirect target from GitHub. Same ownership rule as the GitHub and
 * Google callbacks: the signed-in browser names the owner, and a signed-out one
 * parks the grant (task 842601f2). See lib/sync/browser-callback.ts.
 */
export async function GET(request: NextRequest) {
  // A brand without the copilot agent has no Copilot integration (task 229c175c).
  const gateBlocked = copilotIntegrationGate()
  if (gateBlocked) return gateBlocked

  if (!copilotOAuthConfigured()) {
    return NextResponse.json({ error: 'GitHub Copilot is not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const stateUserId = state ? verifyCopilotOAuthState(state) : null
  if (!code || !stateUserId) {
    return linkErrorPage('copilot', `This connect link has expired. Go back to ${BRAND.appName} and tap Connect again.`)
  }

  return finishBrowserConnect(request, 'copilot', code, stateUserId)
}
