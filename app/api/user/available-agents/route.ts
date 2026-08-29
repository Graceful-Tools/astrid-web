/**
 * Available AI Agents API (legacy path)
 *
 * GET /api/user/available-agents — list AI agents the user can use.
 * v1 twin: /api/v1/users/me/available-agents. Both call
 * lib/ai/available-agents.ts so the two lists cannot drift apart.
 *
 * Built-in agents are offered by EXECUTION MODE (task 9dbe0b17): polling and
 * webhook agents need no provider key, api-mode agents require one, and off
 * agents are hidden even while their key survives.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { listAvailableAgents } from '@/lib/ai/available-agents'
import { createLogger } from '@/lib/logger'

const log = createLogger('user.available-agents')

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)
    const available = await listAvailableAgents(auth.userId)
    return NextResponse.json({ agents: available })
  } catch (error: any) {
    if (error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    log.error({ err: error }, '[Available Agents] GET error:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
