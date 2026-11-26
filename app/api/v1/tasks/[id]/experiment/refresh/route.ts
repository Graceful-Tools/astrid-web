/**
 * POST /api/v1/tasks/:id/experiment/refresh — read every open experiment and verification on the
 * task now, report the ones that concluded, and (only for a task in the Pending results column)
 * settle the task at once (ADEV-279). `lane` says what the lane rules did: `not-in-column`,
 * `stay`, `completed`, `handed-back` or `skipped`.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess } from '@/lib/api-auth-middleware'
import { goalSignalsGate } from '@/lib/goal-signals'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { refreshTaskExperiments } from '@/services/task-experiment.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.experiment.refresh' },
  async (_req, auth, { params }) => {
    const gated = await goalSignalsGate(auth.userId)
    if (gated) return gated
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskAccess(auth.userId, taskId)
    const result = await refreshTaskExperiments(taskId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ...result.value, meta: { apiVersion: 'v1' as const, authSource: auth.source } })
  },
)
