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
  adoptClientScopeGroup,
  UnknownScopeGroupError,
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
 *
 * `scopeGroup` adopts the connection into a scope group and tops its scopes up
 * to that group there and then (AWTD-962). It is how an existing connection
 * gains `chat:read`/`chat:write` without a hand-written UPDATE against the
 * production row — the manual grant Jon rejected on 2026-09-16.
 */
export const PUT = withAuth<RouteContext>(
  { tag: 'v1.oauth.clients.id' },
  async (req, auth, { params }) => {
    const { clientId } = await params
    const body = await req.json()

    const fieldUpdates = {
      name: body.name,
      description: body.description,
      redirectUris: body.redirectUris,
      scopes: body.scopes,
      isActive: body.isActive,
    }
    const adoptGroup = typeof body.scopeGroup === 'string' ? body.scopeGroup : null

    // Adoption WIDENS what a client may be granted, so it needs the same guard
    // as client registration: an interactive session, never a delegated
    // OAuth/MCP token. Otherwise a leaked narrow-scope token could adopt its
    // own client into a broader group and self-escalate.
    if (adoptGroup !== null && auth.source !== 'session') {
      return NextResponse.json(
        { error: 'Changing a client scope group requires an interactive session' },
        { status: 403 }
      )
    }

    // An adoption-only body must not also write the ordinary fields — a PUT
    // with every field undefined would otherwise blank nothing but still write.
    const hasFieldUpdates =
      adoptGroup === null || Object.values(fieldUpdates).some(value => value !== undefined)

    try {
      const client = hasFieldUpdates
        ? await updateOAuthClient(clientId, auth.userId, fieldUpdates)
        : null

      if (adoptGroup !== null) {
        const adopted = await adoptClientScopeGroup(clientId, auth.userId, adoptGroup)
        return NextResponse.json({
          client: adopted.client,
          changed: adopted.changed,
          added: adopted.added,
          meta: { apiVersion: 'v1' },
        })
      }

      return NextResponse.json({
        client,
        meta: { apiVersion: 'v1' },
      })
    } catch (error) {
      // Bound 4: an unrecognised group name is the caller's mistake, not ours.
      if (error instanceof UnknownScopeGroupError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
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
