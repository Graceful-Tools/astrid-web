/**
 * GET    /api/v1/lists/:id/goal-links — the goals this list serves (ADEV-271)
 * PUT    /api/v1/lists/:id/goal-links { goalIds } — replace the list's links
 * DELETE /api/v1/lists/:id/goal-links { goalId | goalIds } — remove links
 *
 * Every task on the list serves the list's goals (computed on read, see tasks/:id/goals). GET is for
 * anyone with a role on the list; PUT and DELETE need list admin (`canUserManageList`). Project Mode only.
 * Rules: services/goal-link.service.ts.
 */
import { withAuth } from '@/lib/api-auth-wrapper'
import { projectModeGate } from '@/lib/project-mode'
import { goalLinkResponse, goalLinkSource, readGoalLinkBody } from '@/lib/api/goal-links-response'
import { getListGoalLinks, removeListGoalLinks, setListGoalLinks } from '@/services/goal-link.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth<RouteContext>(
  { scopes: ['lists:read'], tag: 'v1.lists.goal-links.read' },
  async (_req, auth, { params }) => {
    const gate = await projectModeGate(auth.userId)
    if (gate) return gate
    return goalLinkResponse(await getListGoalLinks((await params).id, auth.userId), auth)
  },
)

export const PUT = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.goal-links.set' },
  async (req, auth, { params }) => {
    const gate = await projectModeGate(auth.userId)
    if (gate) return gate
    const read = await readGoalLinkBody(req)
    if ('error' in read) return read.error
    return goalLinkResponse(await setListGoalLinks((await params).id, auth.userId, read.body, goalLinkSource(auth)), auth)
  },
)

export const DELETE = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.goal-links.remove' },
  async (req, auth, { params }) => {
    const gate = await projectModeGate(auth.userId)
    if (gate) return gate
    const read = await readGoalLinkBody(req)
    if ('error' in read) return read.error
    return goalLinkResponse(await removeListGoalLinks((await params).id, auth.userId, read.body), auth)
  },
)
