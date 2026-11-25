/**
 * GET    /api/v1/tasks/:id/goals — the goals this task serves (ADEV-271)
 * PUT    /api/v1/tasks/:id/goals { goalIds, projectId? } — replace the task's own links in a project
 * DELETE /api/v1/tasks/:id/goals { goalId | goalIds } — remove the task's own links
 *
 * A task's goals are its own links plus the links of its lists in the same project, computed on
 * read (`via: "task" | "list"`). Anyone who can write the task may link it, agents included.
 * `projectId` is needed only when the task's lists span several projects. Project Mode only.
 * Rules: services/goal-link.service.ts.
 */
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess, requireTaskReadAccess } from '@/lib/api-auth-middleware'
import { projectModeGate } from '@/lib/project-mode'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { goalLinkResponse, goalLinkSource, readGoalLinkBody } from '@/lib/api/goal-links-response'
import { getTaskGoals, removeTaskGoals, setTaskGoals } from '@/services/goal-link.service'
import { NextResponse } from 'next/server'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth<RouteContext>(
  { scopes: ['tasks:read'], tag: 'v1.tasks.goals.read' },
  async (_req, auth, { params }) => {
    const gate = await projectModeGate(auth.userId)
    if (gate) return gate
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskReadAccess(auth.userId, taskId)
    return goalLinkResponse(await getTaskGoals(taskId), auth)
  },
)

export const PUT = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.goals.set' },
  async (req, auth, { params }) => {
    const gate = await projectModeGate(auth.userId)
    if (gate) return gate
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskAccess(auth.userId, taskId)
    const read = await readGoalLinkBody(req)
    if ('error' in read) return read.error
    return goalLinkResponse(await setTaskGoals(taskId, auth.userId, read.body, goalLinkSource(auth)), auth)
  },
)

export const DELETE = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.goals.remove' },
  async (req, auth, { params }) => {
    const gate = await projectModeGate(auth.userId)
    if (gate) return gate
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskAccess(auth.userId, taskId)
    const read = await readGoalLinkBody(req)
    if ('error' in read) return read.error
    return goalLinkResponse(await removeTaskGoals(taskId, read.body), auth)
  },
)
