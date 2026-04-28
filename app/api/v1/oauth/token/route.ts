/**
 * OAuth Token Endpoint
 *
 * POST /api/v1/oauth/token
 *
 * Handles multiple OAuth 2.0 grant types:
 * - client_credentials
 * - authorization_code
 * - refresh_token
 */

import { type NextRequest, NextResponse } from 'next/server'
import {
  validateClientCredentials,
  supportsGrantType,
  validateRedirectUri,
} from '@/lib/oauth/oauth-client-manager'
import {
  generateAccessToken,
  exchangeAuthorizationCode,
  refreshAccessToken,
} from '@/lib/oauth/oauth-token-manager'
import { parseScopeString } from '@/lib/oauth/oauth-scopes'
import { oauthTokenRateLimiter, createRateLimitHeaders } from '@/lib/rate-limiter'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.oauth.token')

/**
 * Parse form-urlencoded body
 */
async function parseFormBody(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get('content-type')

  if (contentType?.includes('application/x-www-form-urlencoded')) {
    const text = await req.text()
    const params = new URLSearchParams(text)
    const result: Record<string, string> = {}
    params.forEach((value, key) => {
      result[key] = value
    })
    return result
  }

  // Also support JSON for convenience
  if (contentType?.includes('application/json')) {
    return await req.json()
  }

  return {}
}

/**
 * OAuth error response
 */
function oauthError(
  error: string,
  description?: string,
  statusCode = 400
): NextResponse {
  return NextResponse.json(
    {
      error,
      error_description: description,
    },
    { status: statusCode }
  )
}

/**
 * POST /api/v1/oauth/token
 */
export async function POST(req: NextRequest) {
  // Check rate limit to prevent brute force attacks
  const rateLimitResult = oauthTokenRateLimiter.checkRateLimit(req)
  const rateLimitHeaders = createRateLimitHeaders(rateLimitResult)

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'rate_limit_exceeded',
        error_description: 'Too many token requests. Please try again later.',
      },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders,
          'Retry-After': Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000).toString(),
        },
      }
    )
  }

  try {
    const params = await parseFormBody(req)

    const grantType = params.grant_type
    if (!grantType) {
      return oauthError('invalid_request', 'Missing grant_type parameter')
    }

    // Handle client credentials flow
    if (grantType === 'client_credentials') {
      return await handleClientCredentialsFlow(params)
    }

    // Handle authorization code flow
    if (grantType === 'authorization_code') {
      return await handleAuthorizationCodeFlow(params)
    }

    // Handle refresh token flow
    if (grantType === 'refresh_token') {
      return await handleRefreshTokenFlow(params)
    }

    return oauthError('unsupported_grant_type', `Grant type '${grantType}' is not supported`)
  } catch (error) {
    log.error({ err: error }, 'OAuth token endpoint error')
    return oauthError('server_error', 'An internal error occurred', 500)
  }
}

/**
 * Client Credentials Flow
 * Used by: iOS app, server-to-server integrations
 */
async function handleClientCredentialsFlow(
  params: Record<string, string>
): Promise<NextResponse> {
  const { client_id, client_secret, scope } = params

  if (!client_id || !client_secret) {
    return oauthError('invalid_request', 'Missing client_id or client_secret')
  }

  // Validate client credentials
  const client = await validateClientCredentials(client_id, client_secret)
  if (!client) {
    return oauthError('invalid_client', 'Invalid client credentials', 401)
  }

  // Check if client supports this grant type
  if (!supportsGrantType(client.grantTypes, 'client_credentials')) {
    return oauthError(
      'unauthorized_client',
      'Client not authorized for client_credentials grant'
    )
  }

  // Parse and validate requested scopes
  const requestedScopes = scope ? parseScopeString(scope) : client.scopes
  const allowedScopes = requestedScopes.filter(s => client.scopes.includes(s))

  if (allowedScopes.length === 0) {
    return oauthError('invalid_scope', 'No valid scopes requested')
  }

  // Generate access token
  const tokenResponse = await generateAccessToken(
    client.id,
    client.userId,
    allowedScopes
  )

  return NextResponse.json({
    access_token: tokenResponse.accessToken,
    token_type: tokenResponse.tokenType,
    expires_in: tokenResponse.expiresIn,
    scope: tokenResponse.scope,
  })
}

/**
 * Authorization Code Flow
 * Used by: Third-party integrations, web apps
 */
async function handleAuthorizationCodeFlow(
  params: Record<string, string>
): Promise<NextResponse> {
  const {
    code,
    client_id,
    client_secret,
    redirect_uri,
  } = params

  if (!code || !client_id || !client_secret || !redirect_uri) {
    return oauthError('invalid_request', 'Missing required parameters')
  }

  // Validate client credentials
  const client = await validateClientCredentials(client_id, client_secret)
  if (!client) {
    return oauthError('invalid_client', 'Invalid client credentials', 401)
  }

  // Check if client supports this grant type
  if (!supportsGrantType(client.grantTypes, 'authorization_code')) {
    return oauthError(
      'unauthorized_client',
      'Client not authorized for authorization_code grant'
    )
  }

  // Validate redirect URI
  if (!validateRedirectUri(client.redirectUris, redirect_uri)) {
    return oauthError('invalid_grant', 'Invalid redirect_uri')
  }

  // Exchange code for tokens
  const tokenResponse = await exchangeAuthorizationCode(
    code,
    client.id,
    redirect_uri
  )

  if (!tokenResponse) {
    return oauthError(
      'invalid_grant',
      'Invalid or expired authorization code'
    )
  }

  return NextResponse.json({
    access_token: tokenResponse.accessToken,
    refresh_token: tokenResponse.refreshToken,
    token_type: tokenResponse.tokenType,
    expires_in: tokenResponse.expiresIn,
    scope: tokenResponse.scope,
  })
}

/**
 * Refresh Token Flow
 * Used to refresh expired access tokens
 */
async function handleRefreshTokenFlow(
  params: Record<string, string>
): Promise<NextResponse> {
  const { refresh_token, client_id, client_secret } = params

  if (!refresh_token || !client_id || !client_secret) {
    return oauthError('invalid_request', 'Missing required parameters')
  }

  // Validate client credentials
  const client = await validateClientCredentials(client_id, client_secret)
  if (!client) {
    return oauthError('invalid_client', 'Invalid client credentials', 401)
  }

  // Check if client supports this grant type
  if (!supportsGrantType(client.grantTypes, 'refresh_token')) {
    return oauthError(
      'unauthorized_client',
      'Client not authorized for refresh_token grant'
    )
  }

  // Refresh the access token
  const tokenResponse = await refreshAccessToken(refresh_token, client.id)

  if (!tokenResponse) {
    return oauthError(
      'invalid_grant',
      'Invalid or expired refresh token'
    )
  }

  return NextResponse.json({
    access_token: tokenResponse.accessToken,
    refresh_token: tokenResponse.refreshToken,
    token_type: tokenResponse.tokenType,
    expires_in: tokenResponse.expiresIn,
    scope: tokenResponse.scope,
  })
}
