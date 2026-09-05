import { BRAND } from '@/lib/brand/config'
import { callbackSessionConflicts } from '@/lib/sync/oauth-callback-session'
import { type NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logger'
import {
  copilotOAuthConfigured,
  exchangeCopilotCode,
  githubLoginFor,
  storeCopilotCredential,
  verifyCopilotOAuthState,
} from '@/lib/copilot/oauth'

const log = createLogger('v1.integrations.copilot.callback')

/**
 * GET /api/v1/integrations/copilot/callback?code&state
 * Browser redirect target from GitHub. Exchanges the code, stores the token
 * (encrypted) on the user's CopilotCredential, then shows a "return to app" page.
 */
export async function GET(request: NextRequest) {
  if (!copilotOAuthConfigured()) {
    return NextResponse.json({ error: 'GitHub Copilot is not configured' }, { status: 503 })
  }
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const userId = state ? verifyCopilotOAuthState(state) : null
  if (!code || !userId) {
    return errorPage(`This connect link has expired. Go back to ${BRAND.appName} and tap Connect again.`)
  }

  // Same login-CSRF shape as the GitHub and Google callbacks: the state names
  // the initiator, the signed-in browser names who is actually here
  // (task 842601f2).
  if (await callbackSessionConflicts(request, userId, 'copilot')) {
    return errorPage(
      `This connect link was started from a different ${BRAND.appName} account. Open ${BRAND.appName} and tap Connect again.`,
    )
  }

  const token = await exchangeCopilotCode(code)
  if (!token) {
    log.error('GitHub Copilot token exchange failed')
    return errorPage(`The sign-in code expired before it could be used. Go back to ${BRAND.appName} and tap Connect again.`)
  }

  const login = await githubLoginFor(token.accessToken)
  await storeCopilotCredential(userId, token, login)
  log.info({ userId, login }, 'GitHub Copilot connected')

  return new NextResponse(
    `<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:80px">
      <h2>GitHub Copilot connected ✓</h2><p>${
        login ? `Signed in as <b>${escapeHtml(String(login))}</b>. ` : ''
      }You can return to ${BRAND.appName}.</p>
    </body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

/** Human-readable failure page: Cloudflare replaces raw 5xx responses with its
 *  own error page, so OAuth failures must render as 200 HTML to be seen. */
function errorPage(message: string): NextResponse {
  return new NextResponse(
    `<html><body style="font-family:-apple-system,sans-serif;text-align:center;padding-top:80px">
      <h2>Connection didn't complete</h2><p>${message}</p>
    </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
