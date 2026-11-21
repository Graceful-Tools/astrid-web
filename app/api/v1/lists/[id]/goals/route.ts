/**
 * GET /api/v1/lists/:id/goals — the goals and guardrails of the project this list is in (ADEV-179)
 *
 * For agents and clients that start from a list. Answers `{ listId, projectId, projectName, goals,
 * guardrails, canEdit }` to anyone with a role on the list; a list in no project answers empty lists
 * and `projectId: null`. Goals are stated per project, so there is no list PUT: edit them with
 * PUT /api/v1/projects/:id/goals.
 */
import { withAuth } from '@/lib/api-auth-wrapper'
import { goalsResponse } from '@/lib/api/project-goals-response'
import { getListGoals } from '@/services/project-goals.service'

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
