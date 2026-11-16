/**
 * POST /api/v1/tasks/:id/handoff — hand a task's other half to another list (AWTD-1686).
 *
 *   { targetListId, title, description?, priority?, assigneeId?, aiAgentId? }
 *
 * One step: the half is created Ready on `targetListId`, linked as this task's blocker, and this
 * task waits on it — unassigned, but remembering who held it, so when the half is done this task
 * wakes to Ready assigned back to them (astrid-core Waiting rule R8; services/task-handoff.service.ts).
 *
 * Needs write access to this task (as the blocker route does) and permission to add tasks to the
 * target list (the create's own check). The task may be named by identifier (AWTD-1007) as well as
 * by uuid. 409 `HANDOFF_SOURCE_DONE` for a finished task.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess } from '@/lib/api-auth-middleware'
import { detectPlatform } from '@/lib/analytics-events'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { resolveAgentAuthor, validateMcpAgentSelection } from '@/lib/ai-agent-author'
import { handoffTask } from '@/services/task-handoff.service'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.handoff' },
  async (request, auth, { params }) => {
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskAccess(auth.userId, taskId)

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

    // Who signs the activity lines (AWTD-974/1311): an agent writing with its owner's credentials
    // names itself with `aiAgentId`. Permissions stay the authenticated caller's.
    const agentSelectionError = validateMcpAgentSelection(auth, body.aiAgentId)
    if (agentSelectionError) return NextResponse.json({ error: agentSelectionError }, { status: 400 })
    const actor = await resolveAgentAuthor(auth, typeof body.aiAgentId === 'string' ? body.aiAgentId : null)
    if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: 400 })
    const actingAsAgent = actor.authorId !== auth.userId

    const result = await handoffTask({
      sourceTaskId: taskId,
      targetListId: typeof body.targetListId === 'string' ? body.targetListId : '',
      title: typeof body.title === 'string' ? body.title : '',
      description: typeof body.description === 'string' ? body.description : null,
      priority: typeof body.priority === 'number' ? body.priority : undefined,
      assigneeId: typeof body.assigneeId === 'string' && body.assigneeId ? body.assigneeId : null,
      actorId: auth.userId,
      authorId: actor.authorId,
      actorType: actingAsAgent || auth.isAIAgent ? 'agent' : 'user',
      platform: detectPlatform(request),
    })

    if (!result.ok) {
      return NextResponse.json(
        result.code ? { error: result.error, code: result.code } : { error: result.error },
        { status: result.status },
      )
    }

    const half = result.half as unknown as {
      id: string
      identifier?: string | null
      title: string
      statusRole?: string | null
      lists?: Array<{ id: string }>
    }
    return NextResponse.json(
      {
        taskId,
        half: {
          id: half.id,
          identifier: half.identifier ?? null,
          title: half.title,
          statusRole: half.statusRole ?? null,
          listIds: (half.lists ?? []).map(list => list.id),
        },
        source: result.source,
        returnAssigneeId: result.returnAssigneeId,
        meta: { apiVersion: 'v1', authSource: auth.source },
      },
      { status: 201 },
    )
  },
)
