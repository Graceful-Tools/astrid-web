/**
 * "Waiting on tasks" — a task's blockers, both directions (AWTD-1002).
 *
 * Gated by `projectModeGate`: blocking is a board idea, and hiding the row
 * while leaving this route reachable is not a configuration option.
 *
 * Both tasks in the link may be named by identifier (AWTD-1007) as well as by
 * uuid, as on every other v1 task route (AWTD-1016, AWTD-1086). An identifier
 * that matches nothing is a 404 before any access check.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess } from '@/lib/api-auth-middleware'
import { projectModeGate } from '@/lib/project-mode'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { addBlocker, getBlockersForTask } from '@/services/task-dependency.service'
import type { V1BlockerMutationResponse, V1BlockersResponse } from '@/lib/api-contracts/v1-ios-shapes'

type RouteContext = { params: Promise<{ id: string }> }

const notFound = (error = 'Task not found') => NextResponse.json({ error }, { status: 404 })

export const GET = withAuth<RouteContext>(
  { scopes: ['tasks:read'], tag: 'v1.tasks.blockers.list' },
  async (_request, auth, { params }) => {
    const gate = await projectModeGate(auth.userId)
    if (gate) return gate

    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return notFound()
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

    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return notFound()
    await requireTaskAccess(auth.userId, taskId)

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const rawBlockingTaskId = (body as { blockingTaskId?: unknown })?.blockingTaskId
    if (typeof rawBlockingTaskId !== 'string' || rawBlockingTaskId.trim() === '') {
      return NextResponse.json({ error: 'blockingTaskId is required' }, { status: 400 })
    }

    const blockingTaskId = await resolveTaskIdOrIdentifier(rawBlockingTaskId.trim())
    if (!blockingTaskId) return notFound('Blocking task not found')

    const result = await addBlocker({ taskId, blockingTaskId, userId: auth.userId })

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
        blockingTaskId,
        blockedBy: result.blockedBy,
        meta: { apiVersion: 'v1', authSource: auth.source },
      } satisfies V1BlockerMutationResponse,
      { status: result.created ? 201 : 200 },
    )
  },
)
