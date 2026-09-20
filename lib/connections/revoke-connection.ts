/**
 * Stop one credential without touching its neighbours.
 *
 * Each kind has its own primitive already; this is the one place that knows
 * which to call and, for every kind, proves the row is the caller's before
 * touching it. "Not the caller's" and "does not exist" are the same answer,
 * so a probe learns nothing.
 */

import { prisma } from '@/lib/prisma'
import { updateOAuthClient } from '@/lib/oauth/oauth-client-manager'
import { revokeUserClientTokens } from '@/lib/oauth/oauth-token-manager'
import { deleteCustomAgent } from '@/lib/custom-agents/delete-agent'
import type { V1ConnectionKind } from '@/lib/api-contracts/v1-ios-shapes'

export class ConnectionNotFoundError extends Error {
  constructor(readonly kind: V1ConnectionKind, readonly id: string) {
    super(`No ${kind} connection ${id} for this user`)
    this.name = 'ConnectionNotFoundError'
  }
}

export interface RevokedConnection {
  kind: V1ConnectionKind
  id: string
  revokedTokens?: number
}

export async function revokeConnection(
  userId: string,
  kind: V1ConnectionKind,
  id: string
): Promise<RevokedConnection> {
  switch (kind) {
    case 'authorizedApp': {
      // The client is shared with every account that approved it: revoke the
      // caller's tokens only, and leave the client itself alone.
      const revokedTokens = await revokeUserClientTokens(id, userId)
      if (revokedTokens === 0) throw new ConnectionNotFoundError(kind, id)
      return { kind, id, revokedTokens }
    }
    case 'oauthClient': {
      const client = await prisma.oAuthClient.findFirst({
        where: { id, userId },
        select: { id: true, clientId: true },
      })
      if (!client) throw new ConnectionNotFoundError(kind, id)
      // Disable rather than delete: the configuration survives for the
      // developer section, but nothing can authenticate with it any more.
      await updateOAuthClient(client.clientId, userId, { isActive: false })
      const revokedTokens = await revokeUserClientTokens(client.id, userId)
      return { kind, id, revokedTokens }
    }
    case 'accessToken': {
      const token = await prisma.mCPToken.findFirst({
        where: { id, userId, listId: null, isActive: true },
        select: { id: true },
      })
      if (!token) throw new ConnectionNotFoundError(kind, id)
      await prisma.mCPToken.update({ where: { id: token.id }, data: { isActive: false } })
      return { kind, id }
    }
    case 'customAgent': {
      const deleted = await deleteCustomAgent(userId, id)
      if (!deleted) throw new ConnectionNotFoundError(kind, id)
      return { kind, id }
    }
    case 'webhook': {
      const existing = await prisma.userWebhookConfig.findUnique({ where: { userId } })
      if (!existing) throw new ConnectionNotFoundError(kind, id)
      await prisma.userWebhookConfig.delete({ where: { userId } })
      return { kind, id }
    }
  }
}
