import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { verifyOAuthState } from '@/lib/sync/github'
import { exchangeGoogleCode, googleRequest, googleSyncConfigured, storeGoogleIntegration } from '@/lib/sync/google'

const log = createLogger('v1.integrations.google.callback')

export async function GET(request: NextRequest) {
  if (!googleSyncConfigured()) {
    return NextResponse.json({ error: 'Google Tasks sync is not configured' }, { status: 503 })
  }
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const userId = state ? verifyOAuthState(state) : null
  if (!code || !userId) {
    return errorPage('This connect link has expired. Go back to Astrid and tap Connect again.')
  }
  const redirectUri = `${url.origin}/api/v1/integrations/google/callback`
  const tokens = await exchangeGoogleCode(code, redirectUri)
  // Granular consent: the user can UNCHECK the Tasks permission on Google's
  // consent screen. A token without the tasks scope 403s on every call —
  // catch it here with a clear message instead of an empty tasklist picker.
  if (tokens.access_token && tokens.scope && !tokens.scope.includes('auth/tasks')) {
    return errorPage(
      'Google connected, but Tasks access was not granted. Reconnect and make sure the "Create, edit, organize, and delete all your tasks" box is CHECKED on the Google consent screen.'
    )
  }
  if (!tokens.access_token) {
    log.error({ tokens }, 'Google token exchange failed')
    return errorPage('The sign-in code expired before it could be used. Go back to Astrid and tap Connect again.')
  }
  // Identify the account (userinfo via tasklists owner isn't available; use id_token-less userinfo endpoint)
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const info = await infoRes.json().catch(() => null)
  await storeGoogleIntegration(userId, tokens.access_token, tokens.refresh_token, tokens.expires_in, info?.email ?? null)
  log.info({ userId, email: info?.email }, 'Google Tasks sync connected')
  return returnToApp(
    'astrid://google-tasks/connected',
    'Google Tasks connected ✓',
    `${info?.email ?? ''} — returning to Astrid…`
  )
}

/** Redirect the browser back to the Astrid app via its custom scheme so an in-app
 *  ASWebAuthenticationSession auto-dismisses and reopens the app (matching Google sign-in).
 *  Renders as 200 HTML with a meta/JS redirect + a visible fallback link for a plain browser. */
function returnToApp(appUrl: string, heading: string, message: string): NextResponse {
  return new NextResponse(
    `<html><head>
      <meta http-equiv="refresh" content="0;url=${escapeHtml(appUrl)}">
      <script>window.location.replace(${JSON.stringify(appUrl)})</script>
    </head><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:80px">
      <h2>${escapeHtml(heading)}</h2><p>${escapeHtml(message)}</p>
      <p><a href="${escapeHtml(appUrl)}">Return to Astrid</a></p>
    </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

/** Human-readable failure that ALSO returns to the app (scheme carries the message) so the
 *  in-app session closes and Astrid can surface the error natively. Cloudflare replaces raw
 *  5xx responses, so this stays 200 HTML. */
function errorPage(message: string): NextResponse {
  return returnToApp(
    `astrid://google-tasks/error?message=${encodeURIComponent(message)}`,
    "Connection didn't complete",
    message
  )
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
