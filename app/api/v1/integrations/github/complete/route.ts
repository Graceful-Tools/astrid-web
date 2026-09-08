import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { isAppSchemeRedirect } from '@/lib/sync/app-completed-link'
import { exchangeGithubCode, githubRequest, githubSyncConfigured, storeGithubIntegration } from '@/lib/sync/github'

const log = createLogger('v1.integrations.github.complete')

/**
 * POST /api/v1/integrations/github/complete  { code, redirectUri }
 *
 * The app-completed half of the GitHub link (task 842601f2). GitHub redirects
 * the code to the app's own URL scheme; the app posts it here authenticated,
 * and the token is filed on the CALLER. No `state` is read, so there is
 * nothing for an attacker to forge — see lib/sync/app-completed-link.ts.
 */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations.github.complete', capability: 'syncGithubIssues' },
  async (req: NextRequest, auth) => {
    if (!githubSyncConfigured()) {
      return NextResponse.json({ error: 'GitHub sync is not configured' }, { status: 503 })
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

    const token = await exchangeGithubCode(code, body.redirectUri)
    if (!token) {
      // Never log the exchange response: a partial grant still carries a
      // refresh_token and pino has no redaction configured (task 842601f2).
      log.error({ userId: auth.userId }, 'GitHub token exchange failed')
      return NextResponse.json({ error: 'The sign-in code expired before it could be used' }, { status: 400 })
    }

    const { status, json: user } = await githubRequest(token.accessToken, 'GET', '/user')
    if (status !== 200 || !user?.login) {
      return NextResponse.json({ error: 'Connected, but the account lookup failed' }, { status: 502 })
    }

    await storeGithubIntegration(auth.userId, token.accessToken, user.login, token.scopes)
    log.info({ userId: auth.userId, login: user.login }, 'GitHub sync connected (app-completed)')

    return NextResponse.json({ connected: true, account: user.login })
  }
)
