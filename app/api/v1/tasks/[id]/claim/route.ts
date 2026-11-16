import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import {
  claimsOnBehalfOfAgent,
  parseAgentTaskClaimRequest,
  resolveAgentTaskClaimPrincipal,
  type AgentTaskClaimOutcome,
} from '@/lib/agent-task-claim'
import { claimAgentTask, resolveDelegatedClaimPrincipal } from '@/services/agent-task-claim.service'
import { runtimePrincipalOf } from '@/lib/runtime-binding/task-runtime'
import { runtimeBindingDenialStatus } from '@/lib/runtime-binding/denial-response'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * POST /api/v1/tasks/:id/claim — the agent claim for every board
 * (docs/AGENT_CLAIM_API.md). On by default since AWTD-1688: no env flag, any
 * board, and every claim carries a lease its holder renews with `heartbeat`.
 */
export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.claim' },
  async (request, auth, { params }) => {
    let body
    try {
      body = parseAgentTaskClaimRequest(await request.json())
    } catch {
      return NextResponse.json(
        { error: 'Invalid claim request' },
        { status: 400 },
      )
    }

    // Identifiers are accepted wherever a task id is (AWTD-1016); claim_task says so.
    const { id: rawId } = await params
    const taskId = await resolveTaskIdOrIdentifier(rawId)
    if (!taskId) {
      return NextResponse.json({ outcome: 'not_found', task: null }, { status: 404 })
    }

    // An agent's own credential acts as that agent; a person's (a
    // client-credentials token, AWTD-1688) names the agent it claims for.
    const principal = resolveAgentTaskClaimPrincipal(auth, body.agentMailbox)
      ?? (claimsOnBehalfOfAgent(auth) && body.agentMailbox
        ? await resolveDelegatedClaimPrincipal({ taskId, actorId: auth.userId, agentMailbox: body.agentMailbox })
        : null)
    if (!principal) {
      return NextResponse.json({ outcome: 'forbidden', task: null }, { status: 403 })
    }
    const result = await claimAgentTask({
      taskId,
      userId: auth.userId,
      agentId: principal.agentId,
      action: body.action,
      agentEmail: principal.agentEmail,
      principal: runtimePrincipalOf(auth),
      leaseSeconds: body.leaseSeconds,
    })
    return NextResponse.json(result, {
      status: result.outcome === 'binding_denied' && result.binding
        ? runtimeBindingDenialStatus(result.binding)
        : statusForOutcome(result.outcome),
    })
  },
)

function statusForOutcome(outcome: AgentTaskClaimOutcome): number {
  switch (outcome) {
    case 'claimed':
    case 'already_yours':
    case 'released':
    case 'renewed':
      return 200
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'conflict':
    case 'not_ready':
      return 409
    case 'binding_denied':
      return 403
  }
}
