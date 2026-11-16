/**
 * POST /api/v1/tasks/:id/approvals { action, sha, summary, migration? } — ask a person to approve an
 * action (AWTD-1694). Posts an approval-request comment bound to one action (`deploy` or `migrate`)
 * and one full commit sha. The server marks it, so a reply cannot pose as one. Answers 409 when the
 * orchestration policy already lets the caller do the action alone.
 *
 * The decision is POST /api/v1/tasks/:id/approvals/:commentId. Rules: services/approval.service.ts.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { resolveTaskIdOrIdentifier } from '@/lib/task-identifier'
import { resolveAgentAuthor } from '@/lib/ai-agent-author'
import { agentMailboxFromEmail } from '@/lib/brand/agent-emails'
import { requestApproval } from '@/services/approval.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth<RouteContext>(
  { scopes: ['comments:write'], tag: 'v1.tasks.approvals' },
  async (req, auth, { params }) => {
    const taskId = await resolveTaskIdOrIdentifier((await params).id)
    if (!taskId) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Send a JSON body' }, { status: 400 })

    const author = await resolveAgentAuthor(auth, typeof body.aiAgentId === 'string' ? body.aiAgentId : null)
    if (!author.ok) return NextResponse.json({ error: author.error }, { status: 400 })

    const result = await requestApproval({
      taskId,
      userId: auth.userId,
      authorId: author.authorId,
      agent: agentMailboxFromEmail(author.agentEmail ?? auth.user.email) ?? auth.user.email,
      action: body.action,
      sha: body.sha,
      summary: body.summary,
      migration: body.migration,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json(
      { ...result.value, meta: { apiVersion: 'v1' as const, authSource: auth.source } },
      { status: result.value.created ? 201 : 200 },
    )
  },
)
