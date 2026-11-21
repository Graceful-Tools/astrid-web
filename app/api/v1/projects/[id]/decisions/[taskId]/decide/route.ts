/**
 * POST /api/v1/projects/:id/decisions/:taskId/decide { option } — record the chosen option on the
 * decision task (ADEV-180). `option` is the number the cards show. Re-deciding replaces the record.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { decideProjectDecision } from '@/services/project-decisions.service'

type RouteContext = { params: Promise<{ id: string; taskId: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.decisions.decide' },
  async (req, auth, { params }) => {
    const { id, taskId } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    if (typeof body.option !== 'number' || !Number.isInteger(body.option)) {
      return NextResponse.json({ error: 'Send { option: <number> }' }, { status: 400 })
    }
    const result = await decideProjectDecision({ projectId: id, taskId, userId: auth.userId, option: body.option })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ...result.value, meta: { apiVersion: 'v1' as const, authSource: auth.source } })
  },
)
