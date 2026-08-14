/**
 * POST /api/v1/tasks/copy — copy one task into several lists.
 *
 * The flow lives in lib/task-batch-copy.ts and is shared with the legacy
 * route. This handler owns only OAuth-scoped auth and the `{ task, meta }`
 * envelope. (Task e0613ae5.)
 *
 * Body: { taskId, targetListIds[], assigneeId? }
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { batchCopyTask } from '@/lib/task-batch-copy'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.tasks.copy.batch')

export const POST = withAuth(
  { scopes: ['tasks:write'], tag: 'v1.tasks.copy.batch' },
  async (req, auth) => {
    try {
      const data = await req.json() as {
        taskId?: string
        targetListIds?: string[]
        assigneeId?: string | null
      }

      const result = await batchCopyTask({
        userId: auth.userId,
        taskId: data.taskId,
        targetListIds: data.targetListIds,
        assigneeId: data.assigneeId,
        assigneeProvided: data.assigneeId !== undefined,
      })

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({
        task: result.task,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error copying task (batch)')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
