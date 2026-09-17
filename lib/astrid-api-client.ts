/**
 * Astrid agent OAuth tokens.
 *
 * Despite the filename this makes no HTTP request — it mints access tokens the
 * agent runtime then uses against the v1 API. A review once listed it as "a
 * third API client" to be deleted alongside lib/api.ts and lib/astrid-api-client;
 * deleting it would remove the agent's authentication (task b8b21855).
 *
 * Architecture: Astrid's OAuth client is the app; tokens carry the user's
 * identity so all permission checks use the user's own access rights.
 *
 * It DID duplicate base-URL resolution, which now lives only in lib/base-url.ts.
 */

import { BRAND } from '@/lib/brand/config'
import { prisma } from '@/lib/prisma'
import { SCOPE_GROUPS, type ScopeGroup } from '@/lib/oauth/oauth-scopes'
import { reconcileClientScopes } from '@/lib/oauth/scope-reconcile'

/**
 * The group this agent's connection is provisioned from, named once. The three
 * scope lists this file used to carry were written out separately and had
 * already drifted from each other and from SCOPE_GROUPS (task 9ebfaba7).
 */
const AGENT_SCOPE_GROUP: ScopeGroup = 'ai_agent'
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
  if (!astridUser) throw new Error(`${BRAND.appName} agent user not found`)

  let client = await prisma.oAuthClient.findFirst({
    where: { userId: astridUser.id },
    select: { id: true, scopes: true, scopeGroup: true },
  })

  if (client) {
    // Mark the one client this function owns, so it is reconciled from
    // SCOPE_GROUPS.ai_agent from here on (task 9ebfaba7). This is the whole of
    // the "backfill": one known client, adopted in reviewable code, rather
    // than a blanket UPDATE stamping a group onto every row in production.
    if (client.scopeGroup !== AGENT_SCOPE_GROUP) {
      await prisma.oAuthClient.update({
        where: { id: client.id },
        data: { scopeGroup: AGENT_SCOPE_GROUP },
      })
    }

    // Replaces a hand-rolled reconcile that wrote `data: { scopes: [...] }` —
    // a REPLACE, which silently stripped any scope this client legitimately
    // held beyond its six hardcoded ones. reconcileClientScopes unions.
    const { changed } = await reconcileClientScopes(client.id)
    // Clear token cache so new tokens get updated scopes
    if (changed) tokenCache.clear()
  }

  if (!client) {
    const { createOAuthClient } = await import('@/lib/oauth/oauth-client-manager')
    const credentials = await createOAuthClient({
      userId: astridUser.id,
      name: `${BRAND.appName} Agent`,
      scopes: [...SCOPE_GROUPS[AGENT_SCOPE_GROUP]],
      scopeGroup: AGENT_SCOPE_GROUP,
      grantTypes: ['client_credentials'],
    })
    const created = await prisma.oAuthClient.findFirst({
      where: { clientId: credentials.clientId },
      select: { id: true, scopes: true, scopeGroup: true },
    })
    if (!created) throw new Error(`Failed to create OAuth client for ${BRAND.appName}`)
    client = created
  }

  oauthClientId = client!.id
  return client!.id
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
    [...SCOPE_GROUPS[AGENT_SCOPE_GROUP]]
  )

  tokenCache.set(userId, {
    token: tokenResult.accessToken,
    expiresAt: Date.now() + tokenResult.expiresIn * 1000,
  })

  return tokenResult.accessToken
}
