/**
 * POST /api/tasks/:id/copy (legacy)
 *
 * The copy flow — target-list permission, copy, stats invalidation, refetch,
 * SSE broadcast — lives in lib/task-copy-flow.ts and is shared with the v1
 * route. This handler owns only session auth and a response with no `meta`
 * envelope. (Task e0613ae5.)
 */

import { NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { copyTaskForUser } from "@/lib/task-copy-flow"
import type { RouteContextParams } from "@/types/next"
import { createLogger } from '@/lib/logger'

const log = createLogger('tasks.[id].copy')

export async function POST(
  request: NextRequest,
  context: RouteContextParams<{ id: string }>
) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      )
    }

    const { id: taskId } = await context.params
    const body = await request.json()

    const {
      targetListId,
      preserveDueDate = false,
      preserveAssignee = false,
      includeComments = false
    } = body

    const result = await copyTaskForUser({
      taskId,
      userId: session.user.id,
      targetListId,
      preserveDueDate,
      preserveAssignee,
      includeComments,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      success: true,
      task: result.task,
      message: "Task copied successfully",
    })

  } catch (error) {
    log.error({ err: error }, "Error in copy task API:")
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}
