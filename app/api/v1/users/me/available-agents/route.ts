/**
 * GET /api/v1/users/me/available-agents
 *
 * Lists AI agents the authenticated user can use:
 * - Built-in agents offered by EXECUTION MODE (task 9dbe0b17): polling and
 *   webhook agents run on the user's own harness/server and need no key,
 *   api-mode agents require a valid provider key, off agents are hidden.
 * - Custom Agents the user registered (`openclaw_worker` remains the storage type)
 * - Astrid as the always-available default when any agent is usable
 *
 * Same logic as GET /api/user/available-agents — both call
 * lib/ai/available-agents.ts so the two lists cannot drift apart.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { listAvailableAgents } from '@/lib/ai/available-agents'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.available-agents')

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.available-agents' },
  async (req, auth) => {
    try {
      // ?serverRun=true narrows to models the server can execute (api-mode
      // built-ins with a credential, plus Custom Agents) — what powers @astrid.
      const serverRunOnly =
        new URL(req.url).searchParams.get('serverRun') === 'true'
      const available = await listAvailableAgents(auth.userId, { serverRunOnly })
      return NextResponse.json({
        agents: available,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching available-agents')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
