/**
 * GET /api/v1/lists/:id/agents — which agents are alive on this board (AWTD-1697).
 *
 * Per agent that has checked the board's queue or renewed a claim on it: when it
 * was last seen, whether it has missed its expected interval, and the task it
 * holds. Also whether Ready work has waited past the pickup time, and why when
 * that is known. Anyone who can view the list may read it; a list the caller
 * cannot see answers like one that does not exist.
 */
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { loadListAgentRoster } from '@/services/agent-presence.service'

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAuth<RouteContext>(
  { scopes: ['lists:read'], tag: 'v1.lists.agents' },
  async (_req, auth, { params }) => {
    const { id } = await params
    const roster = await loadListAgentRoster(id, auth.userId)
    if (!roster) return NextResponse.json({ error: 'List not found' }, { status: 404 })
    return NextResponse.json({ roster })
  },
)
