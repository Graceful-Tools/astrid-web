/**
 * POST /api/v1/tasks/:id/approvals — post an approval card (AWTD-1694).
 *
 *   { action: "deploy" | "migrate", sha: "<40-hex commit>", summary: "<what will run>", aiAgentId? }
 *
 * The card is bound to that action and commit. Needs write access to the task, like any comment.
 * Deciding it is POST /api/v1/tasks/:id/approvals/:commentId.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { requireTaskAccess } from '@/lib/api-auth-middleware'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { resolveAgentAuthor, validateMcpAgentSelection } from '@/lib/ai-agent-author'
import { isApprovalAction, isFullSha } from '@/lib/approvals'
import { requestApproval } from '@/services/approval.service'

type RouteContext = { params: Promise<{ id: string }> }

export const POST = withAuth<RouteContext>(
  { scopes: ['tasks:write'], tag: 'v1.tasks.approvals.request' },
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

    if (!isApprovalAction(body.action)) return NextResponse.json({ error: 'action must be "deploy" or "migrate"' }, { status: 400 })
    if (!isFullSha(body.sha)) return NextResponse.json({ error: 'sha must be a full 40-character commit sha' }, { status: 400 })
    if (typeof body.summary !== 'string' || !body.summary.trim()) {
      return NextResponse.json({ error: 'summary must say exactly what will run' }, { status: 400 })
    }

    const agentSelectionError = validateMcpAgentSelection(auth, body.aiAgentId)
    if (agentSelectionError) return NextResponse.json({ error: agentSelectionError }, { status: 400 })
    const actor = await resolveAgentAuthor(auth, typeof body.aiAgentId === 'string' ? body.aiAgentId : null)
    if (!actor.ok) return NextResponse.json({ error: actor.error }, { status: 400 })

    const result = await requestApproval({
      taskId,
      authorId: actor.authorId,
      request: { action: body.action, sha: body.sha },
      summary: body.summary,
    })
    return NextResponse.json(
      { taskId, commentId: result.value.id, created: result.value.created },
      { status: result.value.created ? 201 : 200 },
    )
  },
)
