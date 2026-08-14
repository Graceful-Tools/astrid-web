/**
 * POST /api/v1/lists/:id/leave
 *
 * Leaves a list. Refuses with 400 if the user is the last admin.
 *
 * The rule lives in lib/list-leave.ts and is shared with the legacy route;
 * this handler owns only OAuth scope auth and the `meta` envelope, which is
 * what actually differs between the two. (Task e0613ae5.)
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { leaveList } from '@/lib/list-leave'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.lists.leave')

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.leave' },
  async (_req, auth, { params }) => {
    try {
      const { id: listId } = await params

      const result = await leaveList({
        listId,
        userId: auth.userId,
        userEmail: auth.user.email,
      })

      if (!result.ok) {
        return NextResponse.json(
          result.isLastAdmin
            ? { error: result.error, isLastAdmin: true }
            : { error: result.error },
          { status: result.status }
        )
      }

      return NextResponse.json({
        message: 'Successfully left the list',
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error leaving list')
      return NextResponse.json({ error: 'Failed to leave list' }, { status: 500 })
    }
  }
)
