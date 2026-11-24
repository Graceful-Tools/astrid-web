/**
 * GET  /api/v1/projects/:id/decisions — the project's decisions, open first, each with the option chosen (ADEV-180)
 * POST /api/v1/projects/:id/decisions { title?, listId?, assigneeId? } — start one from the project's goals
 *
 * A decision is a task (its description holds the Decision and the trade-off grid), so POST answers 201
 * with the task and the criteria the project's goals became. Logic: services/project-decisions.service.ts.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { createProjectDecision, listProjectDecisions } from '@/services/project-decisions.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const meta = (source: string) => ({ apiVersion: 'v1' as const, authSource: source })

export const GET = withAuth<RouteContext>(
  { scopes: ['projects:read'], tag: 'v1.projects.decisions' },
  async (_req, auth, { params }) => {
    const { id } = await params
    const result = await listProjectDecisions(id, auth.userId)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ projectId: id, decisions: result.value, meta: meta(auth.source) })
  },
)

export const POST = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.decisions' },
  async (req, auth, { params }) => {
    const { id } = await params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const result = await createProjectDecision({
      projectId: id,
      userId: auth.userId,
      title: typeof body.title === 'string' ? body.title : undefined,
      listId: typeof body.listId === 'string' ? body.listId : undefined,
      assigneeId: typeof body.assigneeId === 'string' || body.assigneeId === null ? body.assigneeId : undefined,
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ ...result.value, meta: meta(auth.source) }, { status: 201 })
  },
)
