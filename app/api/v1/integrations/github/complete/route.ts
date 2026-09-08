import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { isAppSchemeRedirect } from '@/lib/sync/app-completed-link'
import { githubSyncConfigured } from '@/lib/sync/github'
import { completeIntegrationLink } from '@/lib/sync/link-integration'

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
      return NextResponse.json({ error: 'redirectUri must be this app’s URL scheme' }, { status: 400 })
    }

    const result = await completeIntegrationLink('github', auth.userId, code, body.redirectUri)
    if (!result.ok) {
      return result.reason === 'lookup_failed'
        ? NextResponse.json({ error: 'Connected, but the account lookup failed' }, { status: 502 })
        : NextResponse.json({ error: 'The sign-in code expired before it could be used' }, { status: 400 })
    }

    return NextResponse.json({ connected: true, account: result.account })
  }
)
