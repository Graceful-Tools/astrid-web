/**
 * POST /api/lists/:id/manual-order (legacy)
 *
 * The rule — sanitizing the requested order against the list's actual tasks,
 * the cache invalidation and the `list_updated` broadcast — lives in
 * lib/list-manual-order.ts and is shared with the v1 route. This handler owns
 * only session auth and its response shape. (Task 7883f710.)
 */

import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { setListManualOrder } from "@/lib/list-manual-order"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].manual-order')

export async function POST(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params

    let order: unknown
    try {
      order = (await request.json())?.order
    } catch {
      order = undefined
    }

    const result = await setListManualOrder({ listId, userId: session.user.id, order })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    // The whole updated list, which the web client merges into its state.
    return NextResponse.json(result.list)
  } catch (error) {
    log.error({ err: error }, "Error updating manual task order:")
    return NextResponse.json({ error: "Failed to update manual order" }, { status: 500 })
  }
}
