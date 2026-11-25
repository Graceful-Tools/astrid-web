/**
 * PATCH  /api/v1/projects/:id/connectors/:connectorId { name?, endpointUrl?, credential? } — edit one (ADEV-277)
 * DELETE /api/v1/projects/:id/connectors/:connectorId — remove it
 *
 * Owner or admin only, never an agent. `credential: null` removes the stored credential. Removing a
 * connector leaves any goal bound to it as it was: its reading ages into "unknown". Behind the Goal
 * Signals gate. Rules: services/project-connectors.service.ts.
 */
import { withAuth } from '@/lib/api-auth-wrapper'
import { connectorRouteGuard, connectorsResponse } from '@/lib/api/project-connectors-response'
import { deleteConnector, updateConnector } from '@/services/project-connectors.service'

type RouteContext = { params: Promise<{ id: string; connectorId: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PATCH = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.connectors.update' },
  async (req, auth, { params }) => {
    const blocked = await connectorRouteGuard(auth)
    if (blocked) return blocked
    const { id, connectorId } = await params
    const body = await req.json().catch(() => null)
    return connectorsResponse(await updateConnector(id, connectorId, auth.userId, body), auth)
  },
)

export const DELETE = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.connectors.delete' },
  async (_req, auth, { params }) => {
    const blocked = await connectorRouteGuard(auth)
    if (blocked) return blocked
    const { id, connectorId } = await params
    return connectorsResponse(await deleteConnector(id, connectorId, auth.userId), auth)
  },
)
