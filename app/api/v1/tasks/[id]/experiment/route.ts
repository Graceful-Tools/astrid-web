/**
 * GET    /api/v1/tasks/:id/experiment — the task's experiment links and verifications (ADEV-279)
 * POST   /api/v1/tasks/:id/experiment — link an experiment, or start a verification window
 * DELETE /api/v1/tasks/:id/experiment?experimentId= — remove one link
 *
 * POST body:
 *   { kind: "experiment", connectorId, externalKey, url?, decideBy?, projectId? }
 *   { kind: "verification", days | decideBy, projectId? }   records the goal and guardrail values now
 *
 * Behind the goal-signals gate. A link reports on the task on any board; only a task in the Pending
 * results column is moved by it (services/task-experiment.service.ts). Astrid computes no statistics:
 * every number and verdict on an experiment is the experiment service's.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess, requireTaskReadAccess } from '@/lib/api-auth-middleware'
import { goalSignalsGate } from '@/lib/goal-signals'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import {
  getTaskExperiments,
  linkTaskExperiment,
  unlinkTaskExperiment,
  type ExperimentResult,
} from '@/services/task-experiment.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const meta = (authSource: string) => ({ apiVersion: 'v1' as const, authSource })

function failed(result: Extract<ExperimentResult<unknown>, { ok: false }>): NextResponse {
  return NextResponse.json({ error: result.error, ...(result.reason ? { reason: result.reason } : {}) }, { status: result.status })
}

export const GET = withAuth<RouteContext>(
  { scopes: ['tasks:read'], tag: 'v1.tasks.experiment.read' },
  async (_req, auth, { params }) => {
    const gated = await goalSignalsGate(auth.userId)
    if (gated) return gated
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskReadAccess(auth.userId, taskId)
    const result = await getTaskExperiments(taskId)
    if (!result.ok) return failed(result)
    return NextResponse.json({ ...result.value, meta: meta(auth.source) })
  },
)

export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.experiment.create' },
  async (req, auth, { params }) => {
    const gated = await goalSignalsGate(auth.userId)
    if (gated) return gated
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskAccess(auth.userId, taskId)

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Send a JSON object' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Send a JSON object' }, { status: 400 })
    const result = await linkTaskExperiment(taskId, body)
    if (!result.ok) return failed(result)
    return NextResponse.json({ experiment: result.value, meta: meta(auth.source) }, { status: 201 })
  },
)

export const DELETE = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.experiment.delete' },
  async (req, auth, { params }) => {
    const gated = await goalSignalsGate(auth.userId)
    if (gated) return gated
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskAccess(auth.userId, taskId)
    const experimentId = new URL(req.url).searchParams.get('experimentId')?.trim()
    if (!experimentId) return NextResponse.json({ error: 'experimentId is required' }, { status: 400 })
    const result = await unlinkTaskExperiment(taskId, experimentId)
    if (!result.ok) return failed(result)
    return NextResponse.json({ ...result.value, meta: meta(auth.source) })
  },
)
