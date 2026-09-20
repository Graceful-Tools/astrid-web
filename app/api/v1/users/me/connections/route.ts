/**
 * GET /api/v1/users/me/connections
 *
 * Everything that can act as this account — OAuth clients the user created,
 * apps approved on the consent page, Custom Agents, user-level access
 * tokens, and the webhook server — as one list. The consent page has always
 * said an approval can be revoked from settings; this is the list that
 * makes the sentence true. Revoke is the sibling DELETE under [kind]/[id].
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { listConnections } from '@/lib/connections/list-connections'
import type { V1ConnectionsResponse } from '@/lib/api-contracts/v1-ios-shapes'

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.connections' },
  async (_req, auth) => {
    const connections = await listConnections(auth.userId)
    const body: V1ConnectionsResponse = {
      connections,
      meta: { apiVersion: 'v1', authSource: auth.source, total: connections.length },
    }
    return NextResponse.json(body)
  }
)
