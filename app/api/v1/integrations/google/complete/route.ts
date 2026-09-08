import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { isAppSchemeRedirect } from '@/lib/sync/app-completed-link'
import { exchangeGoogleCode, googleSyncConfigured, storeGoogleIntegration } from '@/lib/sync/google'

const log = createLogger('v1.integrations.google.complete')

/**
 * POST /api/v1/integrations/google/complete  { code, redirectUri }
 *
 * The app-completed half of the Google Tasks link (task 842601f2). The token
 * is filed on the CALLER; no `state` is read. See lib/sync/app-completed-link.ts.
 */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations.google.complete', capability: 'syncGoogleTasks' },
  async (req: NextRequest, auth) => {
    if (!googleSyncConfigured()) {
      return NextResponse.json({ error: 'Google Tasks sync is not configured' }, { status: 503 })
    }

    const body = await req.json().catch(() => null)
    const code = typeof body?.code === 'string' ? body.code : null
    if (!code) {
      return NextResponse.json({ error: 'A code is required' }, { status: 400 })
    }
    if (!isAppSchemeRedirect(body?.redirectUri)) {
      return NextResponse.json(
        { error: 'redirectUri must be this app’s URL scheme' },
        { status: 400 }
      )
    }

    const tokens = await exchangeGoogleCode(code, body.redirectUri)

    // Granular consent: the user can UNCHECK the Tasks permission on Google's
    // consent screen. A token without the tasks scope 403s on every call, so
    // catch it here rather than in an empty tasklist picker — same rule the
    // browser callback applies.
    if (tokens?.access_token && tokens.scope && !tokens.scope.includes('auth/tasks')) {
      return NextResponse.json(
        { error: 'Google connected, but Tasks access was not granted. Reconnect and leave the tasks permission checked.' },
        { status: 400 }
      )
    }
    if (!tokens?.access_token) {
      // Never log the exchange response (task 842601f2).
      log.error({ userId: auth.userId }, 'Google token exchange failed')
      return NextResponse.json({ error: 'The sign-in code expired before it could be used' }, { status: 400 })
    }

    const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const info = await infoRes.json().catch(() => null)

    await storeGoogleIntegration(
      auth.userId,
      tokens.access_token,
      tokens.refresh_token,
      tokens.expires_in,
      info?.email ?? null
    )
    log.info({ userId: auth.userId, email: info?.email }, 'Google Tasks connected (app-completed)')

    return NextResponse.json({ connected: true, account: info?.email ?? null })
  }
)
