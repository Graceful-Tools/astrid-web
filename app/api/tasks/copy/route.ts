/**
 * POST /api/tasks/copy (legacy) — copy one task into several lists.
 *
 * The flow lives in lib/task-batch-copy.ts and is shared with the v1 route.
 * This handler owns only session auth and the bare-task response. (Task e0613ae5.)
 */

import { type NextRequest, NextResponse } from "next/server"
import { getUnifiedSession } from "@/lib/session-utils"
import { batchCopyTask } from "@/lib/task-batch-copy"
import type { CopyTaskData } from "@/types/api"
import { createLogger } from '@/lib/logger'

const log = createLogger('tasks.copy')

export async function POST(request: NextRequest) {
  try {
    const session = await getUnifiedSession()

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const data: CopyTaskData = await request.json()

    const result = await batchCopyTask({
      userId: session.user.id,
      taskId: data.taskId,
      targetListIds: data.targetListIds,
      assigneeId: data.assigneeId,
      assigneeProvided: data.assigneeId !== undefined,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.task)
  } catch (error) {
    log.error({ err: error }, "Error copying task:")
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
