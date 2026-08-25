/**
 * GET/PUT /api/v1/users/me/agent-modes
 *
 * Which runtime each of the caller's agents uses: `api` (this server calls the
 * provider on the caller's key) or `polling` (the caller's own harness works the
 * agent's queue). See lib/ai/agent-execution-mode.ts for the resolution rules.
 *
 * Stored alongside the API keys in `User.mcpSettings`, so switching an agent to
 * polling never discards the key that brings it back.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import {
  getAgentExecutionModes,
  isAgentExecutionMode,
  isModeLockedToPolling,
  pollableMailboxes,
  setAgentExecutionMode,
  AGENT_EXECUTION_MODES,
} from '@/lib/ai/agent-execution-mode'
import { agentEmail } from '@/lib/brand/agent-emails'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.agent-modes')

function describeAgents(modes: Record<string, string>) {
  return pollableMailboxes().map(mailbox => ({
    mailbox,
    email: agentEmail(mailbox),
    mode: modes[mailbox],
    // A locked agent still appears — it is in the user's list like any other,
    // and hiding it would make its behaviour unexplainable.
    locked: isModeLockedToPolling(mailbox),
  }))
}

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.agent-modes' },
  async (_req, auth) => {
    try {
      const modes = await getAgentExecutionModes(auth.userId)
      return NextResponse.json({
        agents: describeAgents(modes),
        modes,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      log.error({ err: error }, 'Error fetching agent modes')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * PUT rather than PATCH: setting one agent's mode is an idempotent replacement,
 * and PUT is what lib/api's `apiPut` speaks — which is what keeps the settings
 * toggle on the client API layer (and its offline queue) instead of a raw fetch.
 */
export const PUT = withAuth(
  { scopes: ['user:write'], tag: 'v1.users.me.agent-modes' },
  async (req, auth) => {
    try {
      const body = await req.json()
      const { agent, mode } = body ?? {}

      if (typeof agent !== 'string' || !agent.trim()) {
        return NextResponse.json({ error: 'agent is required' }, { status: 400 })
      }
      if (!isAgentExecutionMode(mode)) {
        return NextResponse.json(
          { error: `mode must be one of: ${AGENT_EXECUTION_MODES.join(', ')}` },
          { status: 400 }
        )
      }

      const mailbox = agent.trim().toLowerCase()
      const modes = await setAgentExecutionMode(auth.userId, mailbox, mode)

      return NextResponse.json({
        agents: describeAgents(modes),
        modes,
        meta: { apiVersion: 'v1' as const, authSource: auth.source },
      })
    } catch (error) {
      // setAgentExecutionMode throws for an unknown or locked agent — a caller
      // error, not a server one, and the message says which.
      const message = error instanceof Error ? error.message : 'Internal server error'
      if (message.includes('Unknown agent') || message.includes('no API mode')) {
        return NextResponse.json({ error: message }, { status: 400 })
      }
      log.error({ err: error }, 'Error updating agent mode')
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
