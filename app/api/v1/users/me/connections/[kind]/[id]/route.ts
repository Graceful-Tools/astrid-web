/**
 * DELETE /api/v1/users/me/connections/:kind/:id
 *
 * Revoke one connection. Session-only, like webhook configuration and OAuth
 * client creation: a delegated token that could revoke its siblings would
 * let one leaked credential take the rest down with it — or, worse, quietly
 * clear the audit trail of what else had access.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { isConnectionKind } from '@/lib/connections/list-connections'
import { ConnectionNotFoundError, revokeConnection } from '@/lib/connections/revoke-connection'
import type { V1ConnectionRevokeResponse } from '@/lib/api-contracts/v1-ios-shapes'

type RouteContext = { params: Promise<{ kind: string; id: string }> }

export const DELETE = withAuth<RouteContext>(
  { scopes: ['user:write'], tag: 'v1.users.me.connections.revoke' },
  async (_req, auth, { params }) => {
    if (auth.source !== 'session') {
      return NextResponse.json(
        { error: 'Revoking a connection requires an interactive session' },
        { status: 403 }
      )
    }

    const { kind, id } = await params
    if (!isConnectionKind(kind)) {
      return NextResponse.json({ error: 'Unknown connection kind' }, { status: 400 })
    }

    try {
      const revoked = await revokeConnection(auth.userId, kind, id)
      const body: V1ConnectionRevokeResponse = {
        success: true,
        ...revoked,
        meta: { apiVersion: 'v1', authSource: auth.source },
      }
      return NextResponse.json(body)
    } catch (error) {
      if (error instanceof ConnectionNotFoundError) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
      }
      throw error
    }
  }
)
