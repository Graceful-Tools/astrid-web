/**
 * POST /api/v1/tasks/:id/cost — report what a task actually cost.
 *
 * Phase 0 of Task Cost Intelligence (task 315949e1). The spec's own test for
 * whether this feature is real: "an agent run writes a TaskCostEvent, and a
 * user without the flag sees nothing." This is the write path that has to work
 * before anything else in the spec is worth building.
 *
 * Body: { provider, model, inputTokens, outputTokens, costMicrocents,
 *         cacheReadTokens?, cacheWriteTokens?, externalId? }
 *
 * Gated on the task_cost capability + flag, and scoped to `tasks:write` — the
 * existing write permission, per the spec's instruction not to invent a
 * parallel permission model.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess } from '@/lib/api-auth-middleware'
import { taskCostGate } from '@/lib/task-cost'
import { recordTaskCost } from '@/lib/task-cost-events'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.tasks.cost')

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.cost' },
  async (req, auth, { params }) => {
    const { id: taskId } = await params

    // Gate before the access check so a deployment without the feature answers
    // 404 rather than leaking whether the task exists.
    const gated = await taskCostGate(auth.userId)
    if (gated) return gated

    // Outside the try/catch below: requireTaskAccess throws ForbiddenError,
    // which the wrapper turns into a 403. Catching it here would report 500.
    await requireTaskAccess(auth.userId, taskId)

    try {
      const body = await req.json()

      const result = await recordTaskCost({
        taskId,
        aiAgentId: typeof body.aiAgentId === 'string' ? body.aiAgentId : null,
        provider: body.provider,
        model: body.model,
        inputTokens: body.inputTokens,
        outputTokens: body.outputTokens,
        // Optional: a provider that reports no cache usage is reporting a real
        // zero, so absence is accepted and only a malformed value is refused.
        cacheReadTokens: body.cacheReadTokens,
        cacheWriteTokens: body.cacheWriteTokens,
        costMicrocents: body.costMicrocents,
        externalId: typeof body.externalId === 'string' ? body.externalId : null,
      })

      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status })
      }

      return NextResponse.json(
        {
          event: result.event,
          duplicate: result.duplicate,
          meta: { apiVersion: 'v1' as const, authSource: auth.source },
        },
        { status: result.duplicate ? 200 : 201 }
      )
    } catch (error) {
      log.error({ err: error }, 'Error recording task cost')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
