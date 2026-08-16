import { NextRequest, NextResponse } from 'next/server'
import {
  createPublicOAuthClient,
  validatePublicClientRegistration,
} from '@/lib/oauth/oauth-client-manager'
import { oauthRegistrationRateLimiter, createRateLimitHeaders } from '@/lib/rate-limiter'
import { capabilityGate } from '@/lib/brand/capabilities'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.oauth.register')

function registrationError(error: string, description: string, status = 400) {
  return NextResponse.json(
    { error, error_description: description },
    { status },
  )
}

/** RFC 7591 registration for secretless MCP clients such as Copilot and Codex. */
export async function POST(request: NextRequest) {
  const blocked = capabilityGate('integrationMcp')
  if (blocked) return blocked

  const limit = await oauthRegistrationRateLimiter.checkRateLimitAsync(request)
  const headers = createRateLimitHeaders(limit)
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'rate_limit_exceeded', error_description: 'Too many client registrations' },
      { status: 429, headers },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return registrationError('invalid_client_metadata', 'Request body must be valid JSON')
  }

  try {
    const registration = validatePublicClientRegistration(
      typeof body === 'object' && body !== null ? body : {},
    )
    const client = await createPublicOAuthClient(registration)

    return NextResponse.json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: ['code'],
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      scope: client.scopes.join(' '),
    }, { status: 201, headers })
  } catch (error) {
    log.warn({ err: error }, 'Rejected dynamic client registration')
    return registrationError(
      'invalid_client_metadata',
      error instanceof Error ? error.message : 'Invalid client metadata',
    )
  }
}
