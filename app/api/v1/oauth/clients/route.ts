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
  type CreateOAuthClientParams,
} from '@/lib/oauth/oauth-client-manager'
import { isConsentAgentMailbox } from '@/lib/oauth/agent-consent'
import { isOAuthClientPreset, oauthClientPreset } from '@/lib/oauth/oauth-client-presets'
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
/**
 * A client minted from the agents page: the transport picked the preset, so
 * the body may name only the preset and the agent. Scopes, grant types and
 * redirect URIs come from the preset — a caller must not be able to hand a
 * preset client a wider scope list than the preset carries.
 */
function presetParams(body: Record<string, unknown>): Omit<CreateOAuthClientParams, 'userId'> | NextResponse {
  if (!isOAuthClientPreset(body.preset)) {
    return NextResponse.json({ error: 'Unknown client preset' }, { status: 400 })
  }
  if (!isConsentAgentMailbox(typeof body.agent === 'string' ? body.agent : null)) {
    return NextResponse.json(
      { error: 'A preset client must name a known agent identity' },
      { status: 400 }
    )
  }
  return oauthClientPreset(body.preset, body.agent as string)
}

/** The developer console's shape: the caller chose everything. */
function bespokeParams(body: Record<string, unknown>): Omit<CreateOAuthClientParams, 'userId'> | NextResponse {
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json(
      { error: 'name is required and must be a string' },
      { status: 400 }
    )
  }
  return {
    name: body.name,
    description: body.description as string | undefined,
    redirectUris: body.redirectUris as string[] | undefined,
    grantTypes: body.grantTypes as string[] | undefined,
    scopes: body.scopes as string[] | undefined,
  }
}

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

    const params = body.preset !== undefined ? presetParams(body) : bespokeParams(body)
    if (params instanceof NextResponse) return params

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
