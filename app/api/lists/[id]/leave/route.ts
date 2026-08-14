/**
 * POST /api/lists/:id/leave (legacy)
 *
 * The leave rule — membership, the last-admin guard, invite cleanup, cache
 * invalidation — lives in lib/list-leave.ts and is shared with the v1 route.
 * This handler owns only session auth and a response with no `meta` envelope.
 * (Task e0613ae5.)
 */

import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { leaveList } from "@/lib/list-leave"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('lists.[id].leave')

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: listId } = await context.params

    const result = await leaveList({
      listId,
      userId: session.user.id,
      userEmail: session.user.email,
    })

    if (!result.ok) {
      return NextResponse.json(
        result.isLastAdmin
          ? { error: result.error, isLastAdmin: true }
          : { error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json({ message: "Successfully left the list" })
  } catch (error) {
    log.error({ err: error }, "Error leaving list:")
    return NextResponse.json({ error: "Failed to leave list" }, { status: 500 })
  }
}
