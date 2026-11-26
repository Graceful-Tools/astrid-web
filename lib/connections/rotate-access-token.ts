/**
 * Rotating a user-level access token (AWTD-1567): a fresh secret with the same
 * grant, and the old one revoked in the same transaction.
 *
 * The replacement copies what the token IS — permissions, explicit scope (or
 * the lack of one), agent binding, description, lifetime — so rotating never
 * widens or narrows a token. An unscoped token stays unscoped (and on '*'); a
 * scoped one keeps its scopes and stays under ASTRID_TOKEN_SCOPE_ENFORCEMENT.
 * A token with an expiry gets the same lifetime again, counted from now.
 */

import { prisma } from '@/lib/prisma'
import { mcpTokenStorageFields } from '@/lib/mcp-token'
import { generateMCPToken } from '@/lib/mcp-token-utils'
import { explicitTokenScopes } from '@/lib/token-scope-enforcement'

export type RotateAccessTokenResult =
  | {
      ok: true
      id: string
      replacedId: string
      token: string
      permissions: string[]
      scopes: string[] | null
      expiresAt: Date | null
      description: string | null
      createdAt: Date
    }
  | { ok: false; status: 403 | 404; error: string }

export async function rotateAccessToken(userId: string, tokenId: string): Promise<RotateAccessTokenResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mcpEnabled: true } })
  if (!user?.mcpEnabled) {
    return { ok: false, status: 403, error: 'MCP access is disabled for your account' }
  }

  const old = await prisma.mCPToken.findFirst({
    where: { id: tokenId, userId, listId: null, isActive: true },
    select: {
      id: true,
      permissions: true,
      scope: true,
      agentUserId: true,
      agentMailbox: true,
      description: true,
      expiresAt: true,
      createdAt: true,
    },
  })
  if (!old) return { ok: false, status: 404, error: 'Access token not found' }

  const lifetimeMs = old.expiresAt
    ? Math.max(new Date(old.expiresAt).getTime() - new Date(old.createdAt).getTime(), 24 * 60 * 60 * 1000)
    : null
  const token = generateMCPToken()

  const row = await prisma.$transaction(async tx => {
    const created = await tx.mCPToken.create({
      data: {
        ...mcpTokenStorageFields(token),
        listId: null,
        userId,
        agentUserId: old.agentUserId,
        agentMailbox: old.agentMailbox,
        permissions: old.permissions,
        scope: old.scope,
        description: old.description,
        expiresAt: lifetimeMs ? new Date(Date.now() + lifetimeMs) : null,
        isActive: true,
      },
    })
    await tx.mCPToken.update({ where: { id: old.id }, data: { isActive: false } })
    return created
  })

  return {
    ok: true,
    id: row.id,
    replacedId: old.id,
    token,
    permissions: row.permissions,
    scopes: explicitTokenScopes(row.scope),
    expiresAt: row.expiresAt,
    description: row.description,
    createdAt: row.createdAt,
  }
}
