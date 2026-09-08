import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { isAppSchemeRedirect } from '@/lib/sync/app-completed-link'
import { googleSyncConfigured } from '@/lib/sync/google'
import { completeIntegrationLink } from '@/lib/sync/link-integration'

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
      return NextResponse.json({ error: 'redirectUri must be this app’s URL scheme' }, { status: 400 })
    }

    const result = await completeIntegrationLink('google', auth.userId, code, body.redirectUri)
    if (!result.ok) {
      return result.reason === 'scope_missing'
        ? NextResponse.json(
            { error: 'Google connected, but Tasks access was not granted. Reconnect and leave the tasks permission checked.' },
            { status: 400 }
          )
        : NextResponse.json({ error: 'The sign-in code expired before it could be used' }, { status: 400 })
    }

    return NextResponse.json({ connected: true, account: result.account })
  }
)
