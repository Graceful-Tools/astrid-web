/**
 * POST /api/v1/tasks/:id/approvals/:commentId { decision: 'approve' | 'decline', reason? }
 * — decide an approval request (AWTD-1694).
 *
 * Only a person the orchestration policy names as an escalation target, never an agent. Approve
 * records who approved and dispatches the production deploy for the request's commit through the
 * GitHub App; Decline records the reason and leaves the task open. The decision is read from this
 * body, never from comment text.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { decideApproval } from '@/services/approval.service'

type RouteContext = { params: Promise<{ id: string; commentId: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth<RouteContext>(
  { scopes: ['comments:write'], tag: 'v1.tasks.approvals.decide' },
  async (req, auth, { params }) => {
    if (auth.isAIAgent || auth.agentUser || auth.user?.isAIAgent) {
      return NextResponse.json({ error: 'An agent cannot approve or decline; a person named by the orchestration policy decides' }, { status: 403 })
    }
    const { id, commentId } = await params
    const taskId = await resolveTaskIdOrIdentifier(id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    const body = (await req.json().catch(() => null)) as { decision?: unknown; reason?: unknown } | null
    const result = await decideApproval({
      taskId,
      requestId: commentId,
      userId: auth.userId,
      userName: auth.user.name || auth.user.email,
      decision: body?.decision,
      reason: body?.reason,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ...result.value, meta: { apiVersion: 'v1' as const, authSource: auth.source } })
  },
)
