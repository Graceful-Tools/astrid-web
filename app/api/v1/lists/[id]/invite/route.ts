/**
 * POST /api/v1/lists/:id/invite
 *
 * Send an email invitation to join a list at a specific role.
 *
 * The flow lives in lib/list-invite.ts and is shared with the legacy route.
 * This handler owns only OAuth-scoped auth and the v1 `meta` envelope.
 * (Task e0613ae5.)
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { inviteToList } from '@/lib/list-invite'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.lists.invite')

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['lists:manage_members'], tag: 'v1.lists.invite' },
  async (req, auth, { params }) => {
    try {
      const { id: listId } = await params
      const { email, role, message } = await req.json()

      const result = await inviteToList({
        listId,
        inviter: {
          id: auth.userId,
          email: auth.user.email ?? '',
          name: auth.user.name ?? null,
        },
        email,
        role,
        message,
      })

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          {
            status: result.status,
            ...(result.retryAfterSeconds !== undefined && {
              headers: { 'Retry-After': String(result.retryAfterSeconds) },
            }),
          }
        )
      }

      return NextResponse.json({
        message: 'Invitation sent successfully',
        invitation: result.invitation,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error sending list invitation')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
