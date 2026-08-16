import { prisma } from '@/lib/prisma'
import { supportsGrantType, validateRedirectUri } from './oauth-client-manager'
import {
  formatScopeString,
  parseScopeString,
  validateScopes,
  type OAuthScope,
} from './oauth-scopes'
import { generateAuthorizationCode } from './oauth-token-manager'

export class OAuthAuthorizationError extends Error {
  public readonly code: string
  public readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}

export interface AuthorizationRequestParams {
  clientId?: string
  redirectUri?: string
  scope?: string
  state?: string
  responseType?: string
  codeChallenge?: string
  codeChallengeMethod?: string
}

interface AuthorizationClient {
  id: string
  clientId: string
  name: string
  description: string | null
  redirectUris: string[]
  grantTypes: string[]
  scopes: OAuthScope[]
  tokenEndpointAuthMethod: string
  owner: {
    id: string
    name: string | null
    email: string | null
  } | null
}

export interface AuthorizationContext {
  client: AuthorizationClient
  redirectUri: string
  scopes: OAuthScope[]
  state?: string
  codeChallenge?: string
  codeChallengeMethod?: 'S256'
}

function normalizeScopeString(scopes: OAuthScope[]): string {
  return formatScopeString(scopes)
}

export async function validateAuthorizationRequest(
  params: AuthorizationRequestParams
): Promise<AuthorizationContext> {
  const {
    clientId,
    redirectUri,
    scope,
    state,
    responseType,
    codeChallenge,
    codeChallengeMethod,
  } = params

  if (!clientId) {
    throw new OAuthAuthorizationError('invalid_client', 'Missing client_id')
  }

  if (!redirectUri) {
    throw new OAuthAuthorizationError('invalid_request', 'Missing redirect_uri')
  }

  if (responseType && responseType !== 'code') {
    throw new OAuthAuthorizationError(
      'unsupported_response_type',
      'Only response_type=code is supported'
    )
  }

  const clientRecord = await prisma.oAuthClient.findFirst({
    where: {
      clientId,
      isActive: true,
    },
    select: {
      id: true,
      clientId: true,
      name: true,
      description: true,
      redirectUris: true,
      grantTypes: true,
      scopes: true,
      tokenEndpointAuthMethod: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  })

  if (!clientRecord) {
    throw new OAuthAuthorizationError('invalid_client', 'OAuth client not found')
  }

  if (!supportsGrantType(clientRecord.grantTypes, 'authorization_code')) {
    throw new OAuthAuthorizationError(
      'unauthorized_client',
      'Client does not support authorization_code grant'
    )
  }

  if (!validateRedirectUri(clientRecord.redirectUris, redirectUri)) {
    throw new OAuthAuthorizationError('invalid_grant', 'Invalid redirect_uri')
  }

  const isPublicClient = clientRecord.tokenEndpointAuthMethod === 'none'
  if (codeChallenge && codeChallengeMethod !== 'S256') {
    throw new OAuthAuthorizationError(
      'invalid_request',
      'Only code_challenge_method=S256 is supported',
    )
  }
  if (
    isPublicClient &&
    (!codeChallenge ||
      codeChallengeMethod !== 'S256' ||
      !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge))
  ) {
    throw new OAuthAuthorizationError(
      'invalid_request',
      'Public OAuth clients require an S256 PKCE code challenge',
    )
  }

  const availableScopes = validateScopes(clientRecord.scopes)

  if (!availableScopes.length) {
    throw new OAuthAuthorizationError(
      'server_error',
      'Client has no valid scopes configured'
    )
  }

  let requestedScopes = availableScopes

  if (scope) {
    const scopeTokens = scope.split(' ').map(s => s.trim()).filter(Boolean)
    if (!scopeTokens.length) {
      throw new OAuthAuthorizationError('invalid_scope', 'No scopes requested')
    }

    const parsedScopes = parseScopeString(scope)
    if (parsedScopes.length !== scopeTokens.length) {
      throw new OAuthAuthorizationError('invalid_scope', 'One or more scopes are invalid')
    }

    const unauthorizedScopes = parsedScopes.filter(s => !availableScopes.includes(s))
    if (unauthorizedScopes.length) {
      throw new OAuthAuthorizationError(
        'invalid_scope',
        `Client is not allowed to request scopes: ${unauthorizedScopes.join(', ')}`
      )
    }

    requestedScopes = parsedScopes
  }

  const uniqueScopes = Array.from(new Set(requestedScopes))

  const client: AuthorizationClient = {
    id: clientRecord.id,
    clientId: clientRecord.clientId,
    name: clientRecord.name,
    description: clientRecord.description,
    redirectUris: clientRecord.redirectUris,
    grantTypes: clientRecord.grantTypes,
    scopes: availableScopes,
    tokenEndpointAuthMethod: clientRecord.tokenEndpointAuthMethod,
    owner: clientRecord.user
      ? {
          id: clientRecord.user.id,
          name: clientRecord.user.name,
          email: clientRecord.user.email,
        }
      : null,
  }

  return {
    client,
    redirectUri,
    scopes: uniqueScopes,
    state: state || undefined,
    codeChallenge: codeChallenge || undefined,
    codeChallengeMethod: codeChallenge ? 'S256' : undefined,
  }
}

export async function createAuthorizationRedirect(
  userId: string,
  context: AuthorizationContext
): Promise<{ redirectUrl: string; code: string }> {
  const code = await generateAuthorizationCode(
    context.client.id,
    userId,
    context.redirectUri,
    context.scopes,
    context.codeChallenge,
    context.codeChallengeMethod,
  )

  const redirectUrl = new URL(context.redirectUri)
  redirectUrl.searchParams.set('code', code)
  redirectUrl.searchParams.set('scope', normalizeScopeString(context.scopes))

  if (context.state) {
    redirectUrl.searchParams.set('state', context.state)
  }

  return {
    redirectUrl: redirectUrl.toString(),
    code,
  }
}

export function buildErrorRedirect(
  context: AuthorizationContext,
  error: string,
  description?: string
): string {
  const redirectUrl = new URL(context.redirectUri)
  redirectUrl.searchParams.set('error', error)
  if (description) {
    redirectUrl.searchParams.set('error_description', description)
  }
  if (context.state) {
    redirectUrl.searchParams.set('state', context.state)
  }
  return redirectUrl.toString()
}
