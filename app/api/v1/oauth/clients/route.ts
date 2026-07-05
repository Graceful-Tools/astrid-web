/**
 * OAuth Clients Management API
 *
 * GET /api/v1/oauth/clients - List user's OAuth clients
 * POST /api/v1/oauth/clients - Create new OAuth client
 *
 * Auth: session OR Bearer token (via withAuth → authenticateAPI). The Bearer
 * path was previously rejected because the route called getServerSession
 * directly; under withAuth it works the same way as every other v1 route
 * (caller can only see/manage their own clients).
 */

import { NextResponse } from 'next/server'
import {
  createOAuthClient,
  listUserOAuthClients,
} from '@/lib/oauth/oauth-client-manager'
import { type CreateOAuthClientParams } from '@/types/oauth'
import { withAuth } from '@/lib/api-auth-wrapper'

/**
 * GET /api/v1/oauth/clients
 * List all OAuth clients for the authenticated user
 */
export const GET = withAuth(
  { tag: 'v1.oauth.clients' },
  async (_req, auth) => {
    const clients = await listUserOAuthClients(auth.userId)

    return NextResponse.json({
      clients,
      meta: { total: clients.length, apiVersion: 'v1' },
    })
  }
)

/**
 * POST /api/v1/oauth/clients
 * Create a new OAuth client application
 *
 * Body:
 * {
 *   name: string (required) - Application name
 *   description?: string - Application description
 *   redirectUris?: string[] - Allowed redirect URIs
 *   grantTypes?: string[] - OAuth grant types to support
 *   scopes?: string[] - Allowed scopes
 * }
 *
 * Returns client credentials (clientSecret is only shown once!)
 */
export const POST = withAuth(
  { tag: 'v1.oauth.clients' },
  async (req, auth) => {
    // Client registration must come from an interactive session, never a
    // delegated OAuth/MCP token — otherwise a leaked narrow-scope token could
    // register a new client and self-escalate.
    if (auth.source !== 'session') {
      return NextResponse.json(
        { error: 'Client registration requires an interactive session' },
        { status: 403 }
      )
    }

    const body = await req.json()

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'name is required and must be a string' },
        { status: 400 }
      )
    }

    const params: CreateOAuthClientParams = {
      name: body.name,
      description: body.description,
      redirectUris: body.redirectUris,
      grantTypes: body.grantTypes,
      scopes: body.scopes,
    }

    const clientCredentials = await createOAuthClient({
      ...params,
      userId: auth.userId,
    })

    return NextResponse.json(
      {
        client: clientCredentials,
        warning: 'Save the client_secret now - it will not be shown again!',
        meta: { apiVersion: 'v1' },
      },
      { status: 201 }
    )
  }
)
