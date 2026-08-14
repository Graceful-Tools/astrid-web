/**
 * PATCH /api/lists/:id/favorite (legacy)
 *
 * The toggle rule lives in lib/list-favorite.ts and is shared with the v1
 * route. This handler owns only session auth and a response with no `meta`
 * envelope. (Task e0613ae5.)
 */

import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { setListFavorite } from "@/lib/list-favorite"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].favorite')

export async function PATCH(request: NextRequest, context: RouteContextParams<{ id: string }>) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const userId = session.user.id
    const { id: listId } = await context.params
    const body = await request.json()
    const { isFavorite } = body

    const result = await setListFavorite({ userId, listId, isFavorite })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      success: true,
      isFavorite: result.isFavorite,
      listId,
      list: result.list,
    })

  } catch (error) {
    log.error({ err: error }, "Error toggling saved filter:")
    return NextResponse.json(
      { error: "Failed to toggle saved filter" },
      { status: 500 }
    )
  }
}
