import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import { githubRequest, githubSyncConfigured, storeGithubIntegration, verifyOAuthState } from '@/lib/sync/github'

const log = createLogger('v1.integrations.github.callback')

/**
 * GET /api/v1/integrations/github/callback?code&state
 * Browser redirect target from GitHub. Exchanges the code, stores the token
 * (encrypted) on the user's Integration, then shows a "return to app" page.
 */
export async function GET(request: NextRequest) {
  if (!githubSyncConfigured()) {
    return NextResponse.json({ error: 'GitHub sync is not configured' }, { status: 503 })
  }
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const userId = state ? verifyOAuthState(state) : null
  if (!code || !userId) {
    return NextResponse.json({ error: 'Invalid or expired OAuth state' }, { status: 400 })
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_SYNC_CLIENT_ID,
      client_secret: process.env.GITHUB_SYNC_CLIENT_SECRET,
      code,
    }),
  })
  const tokenJson = await tokenRes.json().catch(() => null)
  const accessToken = tokenJson?.access_token as string | undefined
  if (!accessToken) {
    log.error({ tokenJson }, 'GitHub token exchange failed')
    return NextResponse.json({ error: 'GitHub token exchange failed' }, { status: 502 })
  }

  const { status, json: user } = await githubRequest(accessToken, 'GET', '/user')
  if (status !== 200 || !user?.login) {
    return NextResponse.json({ error: 'Could not read GitHub account' }, { status: 502 })
  }
  const scopes = (tokenJson?.scope as string | undefined)?.split(',').filter(Boolean) ?? []
  await storeGithubIntegration(userId, accessToken, user.login, scopes)
  log.info({ userId, login: user.login }, 'GitHub sync connected')

  return new NextResponse(
    `<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:80px">
      <h2>GitHub connected ✓</h2><p>Signed in as <b>${user.login}</b>. You can return to Astrid.</p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  )
}
