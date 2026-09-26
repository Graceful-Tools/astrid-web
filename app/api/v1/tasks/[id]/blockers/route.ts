/**
 * "Waiting on tasks" — a task's blockers, both directions (AWTD-1002).
 *
 * Gated by `projectModeGate`: blocking is a board idea, and hiding the row
 * while leaving this route reachable is not a configuration option.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess } from '@/lib/api-auth-middleware'
import { projectModeGate } from '@/lib/project-mode'
import { addBlocker, getBlockersForTask } from '@/services/task-dependency.service'
import type { V1BlockerMutationResponse, V1BlockersResponse } from '@/lib/api-contracts/v1-ios-shapes'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth<RouteContext>(
  { scopes: ['tasks:read'], tag: 'v1.tasks.blockers.list' },
  async (_request, auth, { params }) => {
    const gate = await projectModeGate(auth.userId)
    if (gate) return gate

    const { id: taskId } = await params
    await requireTaskAccess(auth.userId, taskId)

    return NextResponse.json({
      ...(await getBlockersForTask(taskId, auth.userId)),
      meta: { apiVersion: 'v1', authSource: auth.source },
    } satisfies V1BlockersResponse)
  },
)

export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.blockers.add' },
  async (request, auth, { params }) => {
    const gate = await projectModeGate(auth.userId)
    if (gate) return gate

    const { id: taskId } = await params
    await requireTaskAccess(auth.userId, taskId)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const blockingTaskId = (body as { blockingTaskId?: unknown })?.blockingTaskId
    if (typeof blockingTaskId !== 'string' || blockingTaskId.trim() === '') {
      return NextResponse.json({ error: 'blockingTaskId is required' }, { status: 400 })
    }

    const result = await addBlocker({
      taskId,
      blockingTaskId: blockingTaskId.trim(),
      userId: auth.userId,
    })

    if (!result.ok) {
      return NextResponse.json(
        'reason' in result
          ? { error: result.error, reason: result.reason }
          : { error: result.error },
        { status: result.status },
      )
    }

    // 200 rather than 201 when the link already existed: the unique constraint
    // makes the write idempotent, and every surface writes here.
    return NextResponse.json(
      {
        taskId,
        blockingTaskId: blockingTaskId.trim(),
        blockedBy: result.blockedBy,
        meta: { apiVersion: 'v1', authSource: auth.source },
      } satisfies V1BlockerMutationResponse,
      { status: result.created ? 201 : 200 },
    )
  },
)
