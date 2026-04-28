/**
 * Regenerate OAuth Client Secret
 *
 * POST /api/v1/oauth/clients/:clientId/regenerate-secret
 */

import { NextResponse } from 'next/server'
import { regenerateClientSecret } from '@/lib/oauth/oauth-client-manager'
import { withAuth } from '@/lib/api-auth-wrapper'

type RouteContext = { params: Promise<{ clientId: string }> }

/**
 * POST /api/v1/oauth/clients/:clientId/regenerate-secret
 * Regenerate client secret (invalidates old secret)
 */
export const POST = withAuth<RouteContext>(
  { tag: 'v1.oauth.clients.regenerate-secret' },
  async (_req, auth, { params }) => {
    const { clientId } = await params

    try {
      const newSecret = await regenerateClientSecret(clientId, auth.userId)

      return NextResponse.json({
        clientSecret: newSecret,
        warning: 'Save the new client_secret now - it will not be shown again! Old secret is now invalid.',
        meta: { apiVersion: 'v1' },
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
      throw error
    }
  }
)
