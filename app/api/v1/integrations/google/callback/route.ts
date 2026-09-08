import { BRAND } from '@/lib/brand/config'
import { capabilityGate } from '@/lib/brand/capabilities'
import { type NextRequest, NextResponse } from 'next/server'
import { googleSyncConfigured } from '@/lib/sync/google'
import { verifyOAuthState } from '@/lib/sync/oauth-state'
import { finishBrowserConnect } from '@/lib/sync/browser-callback'
import { linkErrorPage } from '@/lib/sync/link-pages'

/**
 * GET /api/v1/integrations/google/callback?code&state
 * Browser redirect target from Google. The token is filed on the account this
 * BROWSER is signed in as (task 842601f2) — see lib/sync/browser-callback.ts.
 */
export async function GET(request: NextRequest) {
  const blocked = capabilityGate('syncGoogleTasks')
  if (blocked) return blocked

  if (!googleSyncConfigured()) {
    return NextResponse.json({ error: 'Google Tasks sync is not configured' }, { status: 503 })
  }

  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const stateUserId = state ? verifyOAuthState(state, 'google') : null
  if (!code || !stateUserId) {
    return linkErrorPage('google', `This connect link has expired. Go back to ${BRAND.appName} and tap Connect again.`)
  }

  // Google requires the redirect_uri echoed on the exchange, so it travels with
  // the grant when the link is parked across a sign-in.
  const redirectUri = `${url.origin}/api/v1/integrations/google/callback`
  return finishBrowserConnect(request, 'google', code, stateUserId, redirectUri)
}
