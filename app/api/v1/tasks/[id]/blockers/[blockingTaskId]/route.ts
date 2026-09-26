/**
 * Remove one blocker (AWTD-1002).
 *
 * Re-runs the promotion gate: removing the last outstanding blocker unblocks
 * the task, exactly as completing that blocker would.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess } from '@/lib/api-auth-middleware'
import { projectModeGate } from '@/lib/project-mode'
import { removeBlocker } from '@/services/task-dependency.service'
import type { V1BlockerMutationResponse } from '@/lib/api-contracts/v1-ios-shapes'

type RouteContext = { params: Promise<{ id: string; blockingTaskId: string }> }

export const DELETE = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.blockers.remove' },
  async (_request, auth, { params }) => {
    const gate = await projectModeGate(auth.userId)
    if (gate) return gate

    const { id: taskId, blockingTaskId } = await params
    await requireTaskAccess(auth.userId, taskId)

    const result = await removeBlocker({ taskId, blockingTaskId, userId: auth.userId })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json({
      taskId,
      blockingTaskId,
      blockedBy: result.blockedBy,
      meta: { apiVersion: 'v1', authSource: auth.source },
    } satisfies V1BlockerMutationResponse)
  },
)
