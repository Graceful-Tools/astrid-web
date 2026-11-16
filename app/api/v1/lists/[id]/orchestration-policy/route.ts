/**
 * GET /api/v1/lists/:id/orchestration-policy — the list's orchestration policy (AWTD-1693)
 * PUT /api/v1/lists/:id/orchestration-policy { policy } — store the list's override (null clears it)
 *
 * GET answers `{ listId, projectId, list, project, effective, engine, canEdit }`: both stored
 * overrides, and the effective policy astrid-core resolves from them (the default, then the
 * project's, then the list's). Any agent or person with a role on the list may read it.
 *
 * PUT takes a `PolicyOverride` (lib/orchestration-policy.ts): every key optional, an absent key
 * inherits, and a value the rules do not know is a 400. Only the list's owner or an admin, and
 * never an agent. The rules and permissions live in services/orchestration-policy.service.ts.
 */
import { withAuth } from '@/lib/api-auth-wrapper'
import { agentPolicyWriteRefusal, policyResponse } from '@/lib/api/orchestration-policy-response'
import { getListOrchestrationPolicy, setListOrchestrationPolicy } from '@/services/orchestration-policy.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth<RouteContext>(
  { scopes: ['lists:read'], tag: 'v1.lists.orchestration-policy' },
  async (_req, auth, { params }) => {
    const { id } = await params
    return policyResponse(await getListOrchestrationPolicy(id, auth.userId), auth)
  },
)

export const PUT = withAuth<RouteContext>(
  { scopes: ['lists:write'], tag: 'v1.lists.orchestration-policy' },
  async (req, auth, { params }) => {
    const refusal = agentPolicyWriteRefusal(auth)
    if (refusal) return refusal
    const { id } = await params
    const body = await req.json().catch(() => null)
    return policyResponse(await setListOrchestrationPolicy(id, auth.userId, body), auth)
  },
)
