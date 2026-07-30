import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { githubSyncConfigured, mintOAuthState } from '@/lib/sync/github'

/**
 * GET /api/v1/integrations/github/authorize
 * Returns the GitHub OAuth URL the client should open (state is HMAC-signed,
 * so the browser callback can identify the user without a web session).
 */
export const GET = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations.github', capability: 'syncGithubIssues' },
  async (_req, auth) => {
    if (!githubSyncConfigured()) {
      return NextResponse.json({ error: 'GitHub sync is not configured on this server' }, { status: 503 })
    }
    const state = mintOAuthState(auth.userId)
    const params = new URLSearchParams({
      client_id: process.env.GITHUB_SYNC_CLIENT_ID!,
      scope: 'repo',
      state,
    })
    return NextResponse.json({ url: `https://github.com/login/oauth/authorize?${params}` })
  }
)
