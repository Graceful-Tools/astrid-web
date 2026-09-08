import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { isAppSchemeRedirect } from '@/lib/sync/app-completed-link'
import {
  copilotIntegrationGate,
  copilotOAuthConfigured,
  exchangeCopilotCode,
  githubLoginFor,
  storeCopilotCredential,
} from '@/lib/copilot/oauth'

const log = createLogger('v1.integrations.copilot.complete')

/**
 * POST /api/v1/integrations/copilot/complete  { code, redirectUri }
 *
 * The app-completed half of the Copilot link (task 842601f2). The credential
 * is filed on the CALLER; no `state` is read. See lib/sync/app-completed-link.ts.
 */
export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.integrations.copilot.complete' },
  async (req: NextRequest, auth) => {
    // A brand without the copilot agent has no Copilot integration (task 229c175c).
    const gateBlocked = copilotIntegrationGate()
    if (gateBlocked) return gateBlocked

    if (!copilotOAuthConfigured()) {
      return NextResponse.json({ error: 'GitHub Copilot is not configured' }, { status: 503 })
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

    const token = await exchangeCopilotCode(code, body.redirectUri)
    if (!token) {
      // Never log the exchange response (task 842601f2).
      log.error({ userId: auth.userId }, 'GitHub Copilot token exchange failed')
      return NextResponse.json({ error: 'The sign-in code expired before it could be used' }, { status: 400 })
    }

    const login = await githubLoginFor(token.accessToken)
    await storeCopilotCredential(auth.userId, token, login)
    log.info({ userId: auth.userId, login }, 'GitHub Copilot connected (app-completed)')

    return NextResponse.json({ connected: true, account: login })
  }
)
