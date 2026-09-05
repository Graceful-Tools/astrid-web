/**
 * The available-agents list: every agent identity this user can hand work to,
 * hydrated into rows a picker can render.
 *
 * One implementation for both GET /api/user/available-agents and
 * GET /api/v1/users/me/available-agents — they carried near-identical copies of
 * this logic, and copies of an offering rule are how the pickers drift apart.
 *
 * Built-in agents are included by EXECUTION MODE, not by key alone
 * (task 9dbe0b17): `polling` and `webhook` agents run on the user's own
 * harness/server and need no provider key; `api` requires a valid key; `off`
 * is hidden even when a key survives. See isAgentOffered.
 */

import { prisma } from '@/lib/prisma'
import { hasValidApiKey } from '@/lib/api-key-cache'
import { ensureAgentUser } from '@/lib/ai/ensure-agent-user'
import { ensureAstridAgent, ASTRID_EMAIL, ASTRID_NAME } from '@/lib/astrid-agent'
import { getBuiltInAgents } from '@/lib/ai/agent-config'
import {
  getAgentExecutionModes,
  isAgentOffered,
  type AgentExecutionMode,
} from '@/lib/ai/agent-execution-mode'
import { agentMailboxFromEmail } from '@/lib/brand/agent-emails'

export interface AvailableAgent {
  id: string
  name: string
  email: string
  image: string | null
  service: string
}

export interface ListAvailableAgentsOptions {
  /**
   * Only agents the server can execute as a MODEL: api-mode built-ins with a
   * valid provider credential, plus registered Custom Agents (they bring their
   * own runtime). Polling/webhook built-ins are fine assignees — the user's
   * harness does the work — but they cannot power server-side features like
   * @astrid (Jon, 2026-09-05).
   */
  serverRunOnly?: boolean
}

export async function listAvailableAgents(
  userId: string,
  options: ListAvailableAgentsOptions = {},
): Promise<AvailableAgent[]> {
  const available: AvailableAgent[] = []
  const modes = await getAgentExecutionModes(userId)

  for (const agent of getBuiltInAgents()) {
    const hasKey = await hasValidApiKey(userId, agent.service)
    const mailbox = agentMailboxFromEmail(agent.email)
    // A built-in outside the mode map behaves as it always did: key = offered.
    const mode: AgentExecutionMode = (mailbox && modes[mailbox]) || (hasKey ? 'api' : 'off')
    if (!isAgentOffered(mode, hasKey)) continue
    if (options.serverRunOnly && mode !== 'api') continue

    // Creates the row if the environment was never seeded. Skip the agent
    // rather than returning its email as the id — Task.assigneeId is FK'd
    // to User.id, so a fake id lists an agent that fails on assignment.
    const agentUser = await ensureAgentUser(agent.email, agent.image)
    if (!agentUser) continue
    available.push({
      id: agentUser.id,
      name: agent.name,
      email: agent.email,
      image: agent.image,
      service: agent.service,
    })
  }

  if (await hasValidApiKey(userId, 'openclaw')) {
    const openclawAgents = await prisma.user.findMany({
      where: {
        isAIAgent: true,
        aiAgentType: 'openclaw_worker',
        aiAgentConfig: { contains: userId },
      },
      select: { id: true, name: true, email: true, image: true },
    })
    for (const agent of openclawAgents) {
      available.push({
        id: agent.id,
        name: agent.name || agent.email,
        email: agent.email,
        image: agent.image,
        service: 'openclaw',
      })
    }
  }

  // Astrid leads the list whenever any agent is usable at all.
  if (available.length > 0) {
    const astrid = await ensureAstridAgent()
    available.unshift({
      id: astrid.id,
      name: ASTRID_NAME,
      email: ASTRID_EMAIL,
      image: astrid.image,
      service: 'astrid',
    })
  }

  return available
}
