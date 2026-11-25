/**
 * GET  /api/v1/projects/:id/connectors — the project's connectors to outside services (ADEV-277)
 * POST /api/v1/projects/:id/connectors { kind, serviceKey, name?, endpointUrl?, credential? } — add one
 *
 * Owner or admin only, never an agent. `serviceKey` is a service the environment defines
 * (`/api/v1/capabilities` → `goalSignals`) or "custom" where the deployment allows a typed URL. A
 * connector is returned without its credential: `hasCredential` says whether one is stored. Behind
 * the Goal Signals gate. Rules: services/project-connectors.service.ts.
 */
import { withAuth } from '@/lib/api-auth-wrapper'
import { connectorRouteGuard, connectorsResponse } from '@/lib/api/project-connectors-response'
import { createConnector, listConnectors } from '@/services/project-connectors.service'

type RouteContext = { params: Promise<{ id: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = withAuth<RouteContext>(
  { scopes: ['projects:read'], tag: 'v1.projects.connectors' },
  async (_req, auth, { params }) => {
    const blocked = await connectorRouteGuard(auth)
    if (blocked) return blocked
    const { id } = await params
    return connectorsResponse(await listConnectors(id, auth.userId), auth)
  },
)

export const POST = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.connectors' },
  async (req, auth, { params }) => {
    const blocked = await connectorRouteGuard(auth)
    if (blocked) return blocked
    const { id } = await params
    const body = await req.json().catch(() => null)
    return connectorsResponse(await createConnector(id, auth.userId, body), auth, 201)
  },
)
