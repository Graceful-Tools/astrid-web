/**
 * POST /api/v1/lists/:id/manual-order
 *
 * Saves a hand-arranged task order for the list.
 *
 * The rule lives in lib/list-manual-order.ts and is shared with the legacy
 * route; this handler owns only OAuth scope auth and the `meta` envelope.
 * (Task 7883f710.)
 *
 * **Why this exists when `PUT /api/v1/lists/:id` already accepts
 * `manualSortOrder`.** That door takes the array verbatim: it does not
 * reconcile it against the tasks actually in the list, and it does not
 * broadcast, so a reorder saved that way can persist ids of tasks that have
 * left the list, silently omit ones that joined, and stay invisible to every
 * other open client until something else forces a refetch. Clients doing
 * drag-reorder want this route; `PUT` remains correct for round-tripping a
 * whole list object.
 *
 * Filed from the Windows client, which refuses unversioned paths
 * (docs/ASTRID.md §0 rule 6) and so could not reach the legacy route at all.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { setListManualOrder } from '@/lib/list-manual-order'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.lists.manual-order')

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.manual-order' },
  async (req, auth, { params }) => {
    try {
      const { id: listId } = await params

      let order: unknown
      try {
        order = (await req.json())?.order
      } catch {
        order = undefined
      }

      const result = await setListManualOrder({ listId, userId: auth.userId, order })

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      // `order` is called out alongside the list because it is what the caller
      // needs to reconcile against: the saved order is not necessarily the one
      // that was sent, and a client that assumes it is will drift.
      return NextResponse.json({
        list: result.list,
        order: result.order,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error updating manual task order')
      return NextResponse.json(
        { error: 'Failed to update manual order' },
        { status: 500 }
      )
    }
  }
)
