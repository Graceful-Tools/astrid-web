/**
 * POST /api/v1/lists/:id/transfer-ownership
 *
 * Hands the list to another member and removes the caller — "Transfer
 * Ownership & Leave" as one atomic call, which is what the button promises.
 *
 * The rule lives in lib/list-ownership-transfer.ts and is shared with the
 * legacy route; this handler owns only OAuth scope auth and the `meta`
 * envelope, which is what actually differs between the two. (Task 359ca48f.)
 *
 * Until this existed the route was legacy-only, so the iOS and Mac apps — which
 * call `/api/v1/...` exclusively (ASTRID.md rule 5) — had to render an
 * explanatory dead end for the one membership action an owner most needs, since
 * an owner cannot simply leave.
 *
 * Scoped `lists:manage_members` rather than `lists:write`, matching `invite`:
 * the action decides who is on the list and who owns it. The `mobile_app` scope
 * group already carries it.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { transferListOwnership } from '@/lib/list-ownership-transfer'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.lists.transfer-ownership')

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth<RouteContext>(
  { scopes: ['lists:manage_members'], tag: 'v1.lists.transfer-ownership' },
  async (req, auth, { params }) => {
    try {
      const { id: listId } = await params

      // A malformed or absent body is the caller's 400, not a 500. The service
      // reports the missing field itself, so parse defensively and let it.
      let newOwnerId: unknown
      try {
        newOwnerId = (await req.json())?.newOwnerId
      } catch {
        newOwnerId = undefined
      }

      const result = await transferListOwnership({
        listId,
        currentUserId: auth.userId,
        newOwnerId: typeof newOwnerId === 'string' ? newOwnerId : '',
      })

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({
        message: 'Ownership transferred successfully',
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error transferring list ownership')
      return NextResponse.json({ error: 'Failed to transfer ownership' }, { status: 500 })
    }
  }
)
