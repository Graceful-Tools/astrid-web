/**
 * OAuth Client Manager
 *
 * Manages OAuth client applications (registration, credentials, validation).
 */

import { prisma } from '@/lib/prisma'
import crypto from 'crypto'
import { hashClientSecret, verifyClientSecret } from './oauth-token-manager'
import { validateRegisterableScopes, type OAuthScope } from './oauth-scopes'

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

  // Verify secret
  if (!verifyClientSecret(clientSecret, client.clientSecret)) {
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
