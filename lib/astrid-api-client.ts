/**
 * Astrid API Client
 *
 * Provides authenticated access to the Astrid v1 API on behalf of users.
 * Used by the Astrid agent runtime to make API calls with proper auth.
 *
 * Architecture: Astrid's OAuth client is the app; tokens carry the user's
 * identity so all permission checks use the user's own access rights.
 */

import { prisma } from '@/lib/prisma'
import { generateAccessToken } from '@/lib/oauth/oauth-token-manager'
import { ASTRID_EMAIL } from '@/lib/astrid-agent'

// Cache tokens per user
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

// Cache the OAuth client database ID
let oauthClientId: string | null = null

/**
 * Ensure Astrid's OAuth client exists and return its database ID.
 */
async function ensureAstridOAuthClient(): Promise<string> {
  if (oauthClientId) return oauthClientId

  const astridUser = await prisma.user.findFirst({
    where: { email: ASTRID_EMAIL, isAIAgent: true },
    select: { id: true },
  })
  if (!astridUser) throw new Error('Astrid agent user not found')

  let client = await prisma.oAuthClient.findFirst({
    where: { userId: astridUser.id },
    select: { id: true },
  })

  if (!client) {
    const { createOAuthClient } = await import('@/lib/oauth/oauth-client-manager')
    const credentials = await createOAuthClient({
      userId: astridUser.id,
      name: 'Astrid Agent',
      scopes: ['tasks:read', 'tasks:write', 'lists:read', 'comments:read', 'comments:write'],
      grantTypes: ['client_credentials'],
    })
    const created = await prisma.oAuthClient.findFirst({
      where: { clientId: credentials.clientId },
      select: { id: true },
    })
    if (!created) throw new Error('Failed to create OAuth client for Astrid')
    client = created
  }

  oauthClientId = client.id
  return client.id
}

/**
 * Get a valid OAuth access token scoped to a specific user.
 * The token carries the user's identity for permission checks.
 */
export async function getTokenForUser(userId: string): Promise<string> {
  const cached = tokenCache.get(userId)
  if (cached && Date.now() < cached.expiresAt - 5 * 60 * 1000) {
    return cached.token
  }

  const clientId = await ensureAstridOAuthClient()
  const tokenResult = await generateAccessToken(
    clientId,
    userId,
    ['tasks:read', 'tasks:write', 'lists:read', 'comments:read', 'comments:write']
  )

  tokenCache.set(userId, {
    token: tokenResult.accessToken,
    expiresAt: Date.now() + tokenResult.expiresIn * 1000,
  })

  return tokenResult.accessToken
}

/**
 * Get the base URL for internal API calls.
 */
export function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL || 'http://localhost:3000'
}
