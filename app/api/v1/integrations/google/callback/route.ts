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
    return NextResponse.json({ error: 'Invalid or expired OAuth state' }, { status: 400 })
  }
  const redirectUri = `${url.origin}/api/v1/integrations/google/callback`
  const tokens = await exchangeGoogleCode(code, redirectUri)
  if (!tokens.access_token) {
    log.error({ tokens }, 'Google token exchange failed')
    return NextResponse.json({ error: 'Google token exchange failed' }, { status: 502 })
  }
  // Identify the account (userinfo via tasklists owner isn't available; use id_token-less userinfo endpoint)
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const info = await infoRes.json().catch(() => null)
  await storeGoogleIntegration(userId, tokens.access_token, tokens.refresh_token, tokens.expires_in, info?.email ?? null)
  log.info({ userId, email: info?.email }, 'Google Tasks sync connected')
  return new NextResponse(
    `<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:80px">
      <h2>Google Tasks connected ✓</h2><p>${info?.email ?? ''} — you can return to Astrid.</p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
