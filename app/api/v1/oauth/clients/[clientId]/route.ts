/**
 * Individual OAuth Client Management
 *
 * GET /api/v1/oauth/clients/:clientId - Get client details
 * PUT /api/v1/oauth/clients/:clientId - Update client
 * DELETE /api/v1/oauth/clients/:clientId - Delete client
 */

import { NextResponse } from 'next/server'
import {
  getOAuthClient,
  updateOAuthClient,
  deleteOAuthClient,
} from '@/lib/oauth/oauth-client-manager'
import { withAuth } from '@/lib/api-auth-wrapper'

type RouteContext = { params: Promise<{ clientId: string }> }

/**
 * GET /api/v1/oauth/clients/:clientId
 */
export const GET = withAuth<RouteContext>(
  { tag: 'v1.oauth.clients.id' },
  async (_req, auth, { params }) => {
    const { clientId } = await params
    const client = await getOAuthClient(clientId)

    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    if (client.userId !== auth.userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    return NextResponse.json({
      client,
      meta: { apiVersion: 'v1' },
    })
  }
)

/**
 * PUT /api/v1/oauth/clients/:clientId
 * Update client configuration
 */
export const PUT = withAuth<RouteContext>(
  { tag: 'v1.oauth.clients.id' },
  async (req, auth, { params }) => {
    const { clientId } = await params
    const body = await req.json()

    try {
      const client = await updateOAuthClient(
        clientId,
        auth.userId,
        {
          name: body.name,
          description: body.description,
          redirectUris: body.redirectUris,
          scopes: body.scopes,
          isActive: body.isActive,
        }
      )

      return NextResponse.json({
        client,
        meta: { apiVersion: 'v1' },
      })
    } catch (error) {
      // updateOAuthClient throws "not found" for both missing and unowned clients
      if (error instanceof Error && error.message.includes('not found')) {
        return NextResponse.json({ error: error.message }, { status: 404 })
      }
      throw error
    }
  }
)

/**
 * DELETE /api/v1/oauth/clients/:clientId
 * Delete OAuth client and all associated tokens
 */
export const DELETE = withAuth<RouteContext>(
  { tag: 'v1.oauth.clients.id' },
  async (_req, auth, { params }) => {
    const { clientId } = await params
    const deleted = await deleteOAuthClient(clientId, auth.userId)

    if (!deleted) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      message: 'OAuth client deleted successfully',
      meta: { apiVersion: 'v1' },
    })
  }
)
