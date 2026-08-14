/**
 * POST /api/v1/tasks/:id/copy
 *
 * Copy a single task to another list (preserving optional fields like
 * dueDate, assignee, comments).
 *
 * The flow itself — target-list permission, copy, stats invalidation, refetch,
 * SSE broadcast — lives in lib/task-copy-flow.ts and is shared with the legacy
 * route. This handler owns only OAuth-scoped auth and the v1 `meta` envelope.
 * (Task e0613ae5.)
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { copyTaskForUser } from '@/lib/task-copy-flow'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.tasks.copy')

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.copy' },
  async (req, auth, { params }) => {
    try {
      const { id: taskId } = await params
      const body = await req.json()
      const {
        targetListId,
        preserveDueDate = false,
        preserveAssignee = false,
        includeComments = false,
      } = body

      const result = await copyTaskForUser({
        taskId,
        userId: auth.userId,
        targetListId,
        preserveDueDate,
        preserveAssignee,
        includeComments,
      })

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json({
        success: true as const,
        task: result.task,
        message: 'Task copied successfully',
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error in v1 copy task')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
