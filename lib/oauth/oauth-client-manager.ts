/**
 * OAuth Client Manager
 *
 * Manages OAuth client applications (registration, credentials, validation).
 */

import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { hashClientSecret, verifyClientSecret } from './oauth-token-manager'
import {
  SCOPE_GROUPS,
  validateRegisterableScopes,
  type OAuthScope,
} from './oauth-scopes'

/**
 * Generate client ID
 */
function generateClientId(): string {
  return `astrid_client_${crypto.randomBytes(16).toString('hex')}`
}

/**
 * Generate client secret
 */
function generateClientSecret(): string {
  return crypto.randomBytes(32).toString('hex')
}

export interface CreateOAuthClientParams {
  userId: string
  name: string
  description?: string
  redirectUris?: string[]
  grantTypes?: string[]
  scopes?: string[]
}

export interface OAuthClientCredentials {
  clientId: string
  clientSecret: string
  name: string
  description: string | null
  redirectUris: string[]
  grantTypes: string[]
  scopes: string[]
  createdAt: Date
}

export interface PublicOAuthClientRegistration {
  name: string
  redirectUris: string[]
  scopes: OAuthScope[]
}

interface DynamicClientRegistrationBody {
  client_name?: unknown
  redirect_uris?: unknown
  token_endpoint_auth_method?: unknown
  grant_types?: unknown
  response_types?: unknown
  scope?: unknown
}

function isSafeRedirectUri(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    if (url.protocol !== 'http:') return false
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

/**
 * Validate RFC 7591 registration input for an OAuth public client.
 *
 * Astrid deliberately registers only the shape MCP hosts need: authorization
 * code + refresh token, no client secret, and exact HTTPS/loopback redirects.
 */
export function validatePublicClientRegistration(
  body: DynamicClientRegistrationBody,
): PublicOAuthClientRegistration {
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
    throw new Error('redirect_uris must contain at least one redirect URI')
  }
  if (
    body.redirect_uris.length > 10 ||
    !body.redirect_uris.every(uri => typeof uri === 'string' && isSafeRedirectUri(uri))
  ) {
    throw new Error('redirect_uris contains an invalid redirect URI')
  }

  const authMethod = body.token_endpoint_auth_method ?? 'none'
  if (authMethod !== 'none') {
    throw new Error('MCP dynamic registration supports public clients only')
  }

  const grantTypes = body.grant_types ?? ['authorization_code', 'refresh_token']
  if (
    !Array.isArray(grantTypes) ||
    !grantTypes.includes('authorization_code') ||
    grantTypes.some(grant => grant !== 'authorization_code' && grant !== 'refresh_token')
  ) {
    throw new Error('Only authorization_code and refresh_token grants are supported')
  }

  const responseTypes = body.response_types ?? ['code']
  if (
    !Array.isArray(responseTypes) ||
    responseTypes.length !== 1 ||
    responseTypes[0] !== 'code'
  ) {
    throw new Error('Only response_type code is supported')
  }

  const scopeTokens =
    typeof body.scope === 'string'
      ? body.scope.split(' ').map(scope => scope.trim()).filter(Boolean)
      : [...SCOPE_GROUPS.ai_agent]
  const scopes = validateRegisterableScopes(scopeTokens)
  if (scopes.length !== scopeTokens.length || scopes.length === 0) {
    throw new Error('scope contains an invalid or unsupported scope')
  }

  return {
    name:
      typeof body.client_name === 'string' && body.client_name.trim()
        ? body.client_name.trim().slice(0, 120)
        : 'MCP Client',
    redirectUris: [...new Set(body.redirect_uris as string[])],
    scopes,
  }
}

export async function createPublicOAuthClient(
  params: PublicOAuthClientRegistration,
): Promise<{
  clientId: string
  clientSecret?: never
  tokenEndpointAuthMethod: 'none'
  name: string
  redirectUris: string[]
  grantTypes: string[]
  scopes: string[]
  createdAt: Date
}> {
  const clientId = generateClientId()
  const client = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecret: null,
      tokenEndpointAuthMethod: 'none',
      name: params.name,
      userId: null,
      redirectUris: params.redirectUris,
      grantTypes: ['authorization_code', 'refresh_token'],
      scopes: params.scopes,
      isActive: true,
    },
  })

  return {
    clientId: client.clientId,
    tokenEndpointAuthMethod: 'none',
    name: client.name,
    redirectUris: client.redirectUris,
    grantTypes: client.grantTypes,
    scopes: client.scopes,
    createdAt: client.createdAt,
  }
}

/**
 * Create a new OAuth client application
 */
export async function createOAuthClient(
  params: CreateOAuthClientParams
): Promise<OAuthClientCredentials> {
  const clientId = generateClientId()
  const clientSecret = generateClientSecret()
  const clientSecretHash = hashClientSecret(clientSecret)

  // Registration input must never yield the wildcard scope (self-escalation).
  const validScopes = params.scopes ? validateRegisterableScopes(params.scopes) : [
    'tasks:read',
    'tasks:write',
    'lists:read',
    'lists:write',
  ]

  const grantTypes = params.grantTypes || ['client_credentials']

  const client = await prisma.oAuthClient.create({
    data: {
      clientId,
      clientSecret: clientSecretHash,
      tokenEndpointAuthMethod: 'client_secret_post',
      name: params.name,
      description: params.description,
      userId: params.userId,
      redirectUris: params.redirectUris || [],
      grantTypes,
      scopes: validScopes,
      isActive: true,
    },
  })

  return {
    clientId: client.clientId,
    clientSecret, // Return plain secret only once!
    name: client.name,
    description: client.description,
    redirectUris: client.redirectUris,
    grantTypes: client.grantTypes,
    scopes: client.scopes,
    createdAt: client.createdAt,
  }
}

/**
 * Validate client credentials
 */
export async function validateClientCredentials(
  clientId: string,
  clientSecret: string
): Promise<{
  id: string
  clientId: string
  userId: string
  scopes: string[]
  grantTypes: string[]
  redirectUris: string[]
  user: {
    id: string
    email: string
    isAIAgent: boolean
  }
} | null> {
  const client = await validateOAuthClient(clientId, clientSecret)

  if (!client || !client.userId || !client.user) {
    return null
  }

  return {
    id: client.id,
    clientId: client.clientId,
    userId: client.userId,
    scopes: client.scopes,
    grantTypes: client.grantTypes,
    redirectUris: client.redirectUris,
    user: client.user,
  }
}

/**
 * Authenticate either a confidential client or an RFC 7591 public client.
 * Supplying a secret for a public client fails closed rather than silently
 * treating it as a different authentication method.
 */
export async function validateOAuthClient(
  clientId: string,
  clientSecret?: string,
): Promise<{
  id: string
  clientId: string
  clientSecret: string | null
  tokenEndpointAuthMethod: string
  userId: string | null
  scopes: string[]
  grantTypes: string[]
  redirectUris: string[]
  user: {
    id: string
    email: string
    isAIAgent: boolean
  } | null
} | null> {
  const client = await prisma.oAuthClient.findUnique({
    where: {
      clientId,
      isActive: true,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          isAIAgent: true,
        },
      },
    },
  })

  if (!client) {
    return null
  }

  const authMethod = client.tokenEndpointAuthMethod || 'client_secret_post'
  if (authMethod === 'none') {
    if (clientSecret || client.clientSecret) return null
  } else if (
    authMethod !== 'client_secret_post' ||
    !clientSecret ||
    !client.clientSecret ||
    !verifyClientSecret(clientSecret, client.clientSecret)
  ) {
    return null
  }

  return { ...client, tokenEndpointAuthMethod: authMethod }
}

/**
 * Get OAuth client by ID (without secret)
 */
export async function getOAuthClient(clientId: string) {
  return await prisma.oAuthClient.findUnique({
    where: { clientId },
    select: {
      id: true,
      clientId: true,
      name: true,
      description: true,
      userId: true,
      redirectUris: true,
      grantTypes: true,
      scopes: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      lastUsedAt: true,
    },
  })
}

/**
 * List OAuth clients for a user
 */
export async function listUserOAuthClients(userId: string) {
  return await prisma.oAuthClient.findMany({
    where: { userId },
    select: {
      id: true,
      clientId: true,
      name: true,
      description: true,
      redirectUris: true,
      grantTypes: true,
      scopes: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  })
}

/**
 * Update OAuth client
 */
export async function updateOAuthClient(
  clientId: string,
  userId: string,
  updates: {
    name?: string
    description?: string
    redirectUris?: string[]
    scopes?: string[]
    isActive?: boolean
  }
) {
  // Validate ownership
  const client = await prisma.oAuthClient.findFirst({
    where: { clientId, userId },
  })

  if (!client) {
    throw new Error('OAuth client not found or access denied')
  }

  const data: any = {}
  if (updates.name !== undefined) data.name = updates.name
  if (updates.description !== undefined) data.description = updates.description
  if (updates.redirectUris !== undefined) data.redirectUris = updates.redirectUris
  if (updates.scopes !== undefined) {
    data.scopes = validateRegisterableScopes(updates.scopes)
  }
  if (updates.isActive !== undefined) data.isActive = updates.isActive

  return await prisma.oAuthClient.update({
    where: { id: client.id },
    data,
    select: {
      id: true,
      clientId: true,
      name: true,
      description: true,
      redirectUris: true,
      grantTypes: true,
      scopes: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      lastUsedAt: true,
    },
  })
}

/**
 * Delete OAuth client (and all associated tokens)
 */
export async function deleteOAuthClient(
  clientId: string,
  userId: string
): Promise<boolean> {
  // Validate ownership
  const client = await prisma.oAuthClient.findFirst({
    where: { clientId, userId },
  })

  if (!client) {
    return false
  }

  // Delete client (CASCADE will delete tokens and auth codes)
  await prisma.oAuthClient.delete({
    where: { id: client.id },
  })

  return true
}

/**
 * Regenerate client secret
 */
export async function regenerateClientSecret(
  clientId: string,
  userId: string
): Promise<string> {
  // Validate ownership
  const client = await prisma.oAuthClient.findFirst({
    where: { clientId, userId },
  })

  if (!client) {
    throw new Error('OAuth client not found or access denied')
  }

  const newSecret = generateClientSecret()
  const newSecretHash = hashClientSecret(newSecret)

  await prisma.oAuthClient.update({
    where: { id: client.id },
    data: { clientSecret: newSecretHash },
  })

  return newSecret
}

/**
 * Check if client supports a grant type
 */
export function supportsGrantType(
  grantTypes: string[],
  requestedGrantType: string
): boolean {
  return grantTypes.includes(requestedGrantType)
}

/**
 * Validate redirect URI against client's registered URIs
 */
export function validateRedirectUri(
  registeredUris: string[],
  requestedUri: string
): boolean {
  return registeredUris.includes(requestedUri)
}
