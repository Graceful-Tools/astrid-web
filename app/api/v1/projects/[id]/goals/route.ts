/**
 * GET /api/v1/projects/:id/goals — what the project is trying to achieve and must not do (ADEV-179)
 * PUT /api/v1/projects/:id/goals { goals } — store it (null clears it)
 *
 * GET answers `{ projectId, goals, canEdit }` to the project's owner and members; `goals` is
 * `{ goals: Goal[], guardrails: Guardrail[] }` (lib/goals-guardrails.ts) or null. PUT is for its
 * owner or an admin, never an agent; a bad value is a 400. Rules in services/goals-guardrails.service.ts.
 */
import { withAuth } from '@/lib/api-auth-wrapper'
import { agentGoalsWriteRefusal, goalsResponse } from '@/lib/api/goals-response'
import { getProjectGoals, setProjectGoals } from '@/services/goals-guardrails.service'

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
    const body = await req.json().catch(() => null)
    return goalsResponse(await setProjectGoals(id, auth.userId, body), auth)
  },
)
