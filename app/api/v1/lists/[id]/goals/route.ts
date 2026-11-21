/**
 * GET /api/v1/lists/:id/goals — the goals and guardrails in effect on a list (ADEV-179)
 *
 * A list has no goals of its own: it inherits its project's. Answers `{ listId, projectId, goals,
 * canEdit }`, `goals` null when the list has no project or its project states none. Any agent or
 * person with a role on the list may read it; it is edited on the project
 * (PUT /api/v1/projects/:id/goals). Rules in services/goals-guardrails.service.ts.
 */
import { withAuth } from '@/lib/api-auth-wrapper'
import { goalsResponse } from '@/lib/api/goals-response'
import { getListGoals } from '@/services/goals-guardrails.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth<RouteContext>(
  { scopes: ['lists:read'], tag: 'v1.lists.goals' },
  async (_req, auth, { params }) => {
    const { id } = await params
    return goalsResponse(await getListGoals(id, auth.userId), auth)
  },
)
