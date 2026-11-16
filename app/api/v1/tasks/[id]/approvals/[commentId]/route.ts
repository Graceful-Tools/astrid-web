/**
 * POST /api/v1/tasks/:id/approvals/:commentId — decide an approval card (AWTD-1694).
 *
 *   { decision: "approve" | "decline", reason? }      (a decline needs its reason)
 *
 * Only the people the board's orchestration policy names as escalation targets may decide, and it
 * is the signed-in person's own decision: an agent is refused. Approve dispatches the deploy bound
 * to the card's commit. A reply on the task is never an approval.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess } from '@/lib/api-auth-middleware'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { decideApproval } from '@/services/approval.service'

type RouteContext = { params: Promise<{ id: string; commentId: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.approvals.decide' },
  async (request, auth, { params }) => {
    const { id, commentId } = await params
    const taskId = await resolveTaskIdOrIdentifier(id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    await requireTaskAccess(auth.userId, taskId)
    if (auth.isAIAgent) {
      return NextResponse.json({ error: 'An agent cannot approve its own request', code: 'NOT_AN_APPROVER' }, { status: 403 })
    }

    let body: { decision?: unknown; reason?: unknown }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (body?.decision !== 'approve' && body?.decision !== 'decline') {
      return NextResponse.json({ error: 'decision must be "approve" or "decline"' }, { status: 400 })
    }

    const result = await decideApproval({
      taskId,
      commentId,
      userId: auth.userId,
      verdict: body.decision,
      reason: typeof body.reason === 'string' ? body.reason : null,
    })
    if (!result.ok) {
      return NextResponse.json(result.code ? { error: result.error, code: result.code } : { error: result.error }, { status: result.status })
    }
    return NextResponse.json({
      taskId,
      commentId,
      verdict: result.value.verdict,
      dispatched: result.value.dispatched,
      decision: result.value.comment,
    })
  },
)
