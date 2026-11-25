/**
 * POST /api/v1/projects/:id/connectors/:connectorId/test { metricKey? } — call the service once (ADEV-277)
 *
 * Answers `{ ok, error, reading, connector }` and records the outcome on the connector (`state`,
 * `lastOkAt`, `lastError`). With a `metricKey` the reading for that key comes back; without one only
 * reachability is tested. A failed call is a 200 with `ok: false`, since the request itself worked.
 * Owner or admin only, never an agent. Behind the Goal Signals gate.
 */
import { withAuth } from '@/lib/api-auth-wrapper'
import { connectorRouteGuard, connectorsResponse } from '@/lib/api/project-connectors-response'
import { testConnector } from '@/services/project-connectors.service'

type RouteContext = { params: Promise<{ id: string; connectorId: string }> }

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export const POST = withAuth<RouteContext>(
  { scopes: ['projects:write'], tag: 'v1.projects.connectors.test' },
  async (req, auth, { params }) => {
    const blocked = await connectorRouteGuard(auth)
    if (blocked) return blocked
    const { id, connectorId } = await params
    const body = await req.json().catch(() => null)
    return connectorsResponse(await testConnector(id, connectorId, auth.userId, body), auth)
  },
)
