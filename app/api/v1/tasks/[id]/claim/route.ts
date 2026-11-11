import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { NextResponse, type NextRequest } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import {
  parseAgentTaskClaimRequest,
  resolveAgentTaskClaimPrincipal,
  type AgentTaskClaimOutcome,
} from '@/lib/agent-task-claim'
import { claimAgentTask } from '@/services/agent-task-claim.service'

type RouteContext = { params: Promise<{ id: string }> }

const handlePost = withAuth<RouteContext>(
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

    const principal = resolveAgentTaskClaimPrincipal(auth, body.agentMailbox)
    if (!principal) {
      return NextResponse.json({ outcome: 'forbidden', task: null }, { status: 403 })
    }

    // Identifiers are accepted wherever a task id is (AWTD-1016); claim_task says so.
    const { id: rawId } = await params
    const taskId = await resolveTaskIdOrIdentifier(rawId)
    if (!taskId) {
      return NextResponse.json({ outcome: 'not_found', task: null }, { status: 404 })
    }
    const result = await claimAgentTask({
      taskId,
      userId: auth.userId,
      agentId: principal.agentId,
      action: body.action,
    })
    return NextResponse.json(result, {
      status: statusForOutcome(result.outcome),
    })
  },
)

function statusForOutcome(outcome: AgentTaskClaimOutcome): number {
  switch (outcome) {
    case 'claimed':
    case 'already_yours':
    case 'released':
      return 200
    case 'not_found':
      return 404
    case 'forbidden':
      return 403
    case 'conflict':
    case 'not_ready':
      return 409
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (process.env.ASTRID_AGENT_CLAIM_API !== 'on') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return handlePost(request, context)
}
