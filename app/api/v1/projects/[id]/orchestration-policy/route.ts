/**
 * GET /api/v1/projects/:id/orchestration-policy — the project's orchestration policy (AWTD-1693)
 * PUT /api/v1/projects/:id/orchestration-policy { policy } — store it (null clears it)
 *
 * One policy per project, which every list in it inherits unless the list overrides a field
 * (GET /api/v1/lists/:id/orchestration-policy answers the effective policy for a list). GET answers
 * `{ projectId, project, effective, engine, canEdit }` to the project's owner and members. PUT is
 * for its owner or an admin, never an agent; a value the rules do not know is a 400. The rules and
 * permissions live in services/orchestration-policy.service.ts.
 */
import { withAuth } from '@/lib/api-auth-wrapper'
import { agentPolicyWriteRefusal, policyResponse } from '@/lib/api/orchestration-policy-response'
import { getProjectOrchestrationPolicy, setProjectOrchestrationPolicy } from '@/services/orchestration-policy.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth<RouteContext>(
  { scopes: ['projects:read'], tag: 'v1.projects.orchestration-policy' },
  async (_req, auth, { params }) => {
    const { id } = await params
    return policyResponse(await getProjectOrchestrationPolicy(id, auth.userId), auth)
  },
)

export const PUT = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.orchestration-policy' },
  async (req, auth, { params }) => {
    const refusal = agentPolicyWriteRefusal(auth)
    if (refusal) return refusal
    const { id } = await params
    const body = await req.json().catch(() => null)
    return policyResponse(await setProjectOrchestrationPolicy(id, auth.userId, body), auth)
  },
)
