import { BRAND } from '@/lib/brand/config'
import { capabilityGate } from '@/lib/brand/capabilities'
import { type NextRequest, NextResponse } from 'next/server'
import { githubSyncConfigured } from '@/lib/sync/github'
import { verifyOAuthState } from '@/lib/sync/oauth-state'
import { finishBrowserConnect } from '@/lib/sync/browser-callback'
import { linkErrorPage } from '@/lib/sync/link-pages'

/**
 * GET /api/v1/integrations/github/callback?code&state
 * Browser redirect target from GitHub. The token is filed on the account this
 * BROWSER is signed in as, not the one the state names — see
 * lib/sync/browser-callback.ts for why, and for what happens when nobody is
 * signed in (task 842601f2).
 */
export async function GET(request: NextRequest) {
  const blocked = capabilityGate('syncGithubIssues')
  if (blocked) return blocked

  if (!githubSyncConfigured()) {
    return NextResponse.json({ error: 'GitHub sync is not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const stateUserId = state ? verifyOAuthState(state, 'github') : null
  if (!code || !stateUserId) {
    return linkErrorPage('github', `This connect link has expired. Go back to ${BRAND.appName} and tap Connect again.`)
  }

  return finishBrowserConnect(request, 'github', code, stateUserId)
}
