/**
 * GET /api/v1/projects/:id/goals — the project's goals and guardrails (ADEV-179)
 * PUT /api/v1/projects/:id/goals { goals, guardrails } — replace them (null, or both empty, clears)
 *
 * GET answers `{ projectId, projectName, goals, guardrails, canEdit }` to everyone working in the
 * project: its owner, its members and the people (and agents) on its lists. PUT is for its owner or
 * an admin, never an agent; a value the rules refuse is a 400. Shape: lib/goals-guardrails.ts;
 * permissions: services/project-goals.service.ts.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { agentGoalsWriteRefusal, goalsResponse } from '@/lib/api/project-goals-response'
import { getProjectGoals, setProjectGoals } from '@/services/project-goals.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth<RouteContext>(
  { scopes: ['projects:read'], tag: 'v1.projects.goals' },
  async (_req, auth, { params }) => {
    const { id } = await params
    return goalsResponse(await getProjectGoals(id, auth.userId), auth)
  },
)

export const PUT = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.goals' },
  async (req, auth, { params }) => {
    const refusal = agentGoalsWriteRefusal(auth)
    if (refusal) return refusal
    const { id } = await params
    const text = await req.text()
    let body: unknown
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      return NextResponse.json({ error: 'Send { goals, guardrails } as JSON' }, { status: 400 })
    }
    return goalsResponse(await setProjectGoals(id, auth.userId, body), auth)
  },
)
