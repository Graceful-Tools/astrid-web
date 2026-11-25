/**
 * The v1 envelope the connector routes share (ADEV-277): app/api/v1/projects/[id]/connectors and
 * its `[connectorId]` and `test` children.
 */
import { NextResponse } from 'next/server'
import type { AuthContext } from '@/lib/api-auth-middleware'
import { isAgentCaller } from '@/lib/api/orchestration-policy-response'
import { goalSignalsGate } from '@/lib/goal-signals'
import type { ConnectorsResult } from '@/services/project-connectors.service'

/**
 * A connector decides where a goal's number comes from, so an agent may neither read nor change one,
 * even with a token that could otherwise write the project. A person manages them in settings.
 */
export function agentConnectorRefusal(auth: AuthContext): NextResponse | null {
  if (!isAgentCaller(auth)) return null
  return NextResponse.json(
    { error: "An agent cannot manage a project's connectors; the project owner or an admin does, in settings" },
    { status: 403 },
  )
}

/** The agent refusal, then the Goal Signals gate (capability 404, flag 403 `not_granted`). Null to continue. */
export async function connectorRouteGuard(auth: AuthContext): Promise<NextResponse | null> {
  return agentConnectorRefusal(auth) ?? (await goalSignalsGate(auth.userId))
}

export function connectorsResponse<T extends object>(result: ConnectorsResult<T>, auth: AuthContext, status = 200): NextResponse {
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ...result.value, meta: { apiVersion: 'v1' as const, authSource: auth.source } }, { status })
}
