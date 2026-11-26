/**
 * GET  /api/v1/tasks/:id/estimates — the latest estimate and its history (ADEV-278)
 * POST /api/v1/tasks/:id/estimates — ask an estimator for one, or record a person's own
 *
 * POST body:
 *   { estimator?: "builtin" | "<service key>", projectId? }      ask. 201 with the estimate, or 202
 *                                                                 when a service is still working.
 *   { source: "human", goalImpacts, guardrailImpacts, risk, costMicrocents, effortHours, reach,
 *     confidence, rationale, projectId? }                         record a person's estimate.
 *
 * An agent never writes an estimate: it may ask (the server writes the row from the estimator's
 * reply), but `source: "human"` from an agent is refused. Behind the goal-signals gate. Rules:
 * services/task-estimate.service.ts and lib/task-estimate.ts.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess, requireTaskReadAccess } from '@/lib/api-auth-middleware'
import { goalSignalsGate } from '@/lib/goal-signals'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { agentMailboxFromEmail } from '@/lib/brand/agent-emails'
import { isAgentCaller } from '@/lib/api/orchestration-policy-response'
import {
  getTaskEstimates,
  recordHumanEstimate,
  requestTaskEstimate,
  type EstimateResult,
} from '@/services/task-estimate.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function meta(authSource: string) {
  return { apiVersion: 'v1' as const, authSource }
}

function failed(result: Extract<EstimateResult<unknown>, { ok: false }>): NextResponse {
  return NextResponse.json(
    { error: result.error, ...(result.reason ? { reason: result.reason } : {}) },
    { status: result.status },
  )
}

export const GET = withAuth<RouteContext>(
  { scopes: ['tasks:read'], tag: 'v1.tasks.estimates.read' },
  async (req, auth, { params }) => {
    const gated = await goalSignalsGate(auth.userId)
    if (gated) return gated
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskReadAccess(auth.userId, taskId)
    const projectId = new URL(req.url).searchParams.get('projectId') || undefined
    const result = await getTaskEstimates(taskId, projectId)
    if (!result.ok) return failed(result)
    return NextResponse.json({ ...result.value, meta: meta(auth.source) })
  },
)

export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.estimates.create' },
  async (req, auth, { params }) => {
    const gated = await goalSignalsGate(auth.userId)
    if (gated) return gated
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskAccess(auth.userId, taskId)

    let body: Record<string, unknown> = {}
    const text = await req.text()
    if (text) {
      try {
        const parsed = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
        body = parsed as Record<string, unknown>
      } catch {
        return NextResponse.json({ error: 'Send a JSON object' }, { status: 400 })
      }
    }
    const projectId = typeof body.projectId === 'string' && body.projectId.trim() ? body.projectId.trim() : undefined

    if (body.source === 'human') {
      if (isAgentCaller(auth)) {
        return NextResponse.json(
          { error: 'An agent cannot write an estimate; ask an estimator with { estimator? } instead' },
          { status: 403 },
        )
      }
      const result = await recordHumanEstimate(taskId, auth.userId, body, projectId)
      if (!result.ok) return failed(result)
      return NextResponse.json({ estimate: result.value, meta: meta(auth.source) }, { status: 201 })
    }

    const estimator = typeof body.estimator === 'string' && body.estimator.trim() ? body.estimator.trim() : undefined
    const result = await requestTaskEstimate(taskId, auth.userId, {
      estimator,
      projectId,
      // An agent asking the built-in estimator needs `spend` (ADEV-283); an unknown mailbox fails closed.
      agentMailbox: isAgentCaller(auth)
        ? agentMailboxFromEmail(auth.agentUser?.email ?? auth.user?.email) ?? 'unknown-agent'
        : undefined,
    })
    if (!result.ok) return failed(result)
    if (result.value.state === 'pending') {
      return NextResponse.json(
        { pending: true, estimator: result.value.service, meta: meta(auth.source) },
        { status: 202 },
      )
    }
    return NextResponse.json({ estimate: result.value.estimate, meta: meta(auth.source) }, { status: 201 })
  },
)
