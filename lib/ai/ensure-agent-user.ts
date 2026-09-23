/**
 * Lazily create the User row backing a built-in AI agent.
 *
 * Agent rows are normally seeded by scripts/create-specific-ai-agents.ts, but
 * that is a manual step that is easy to forget on a new environment. When it is
 * skipped, the agent listings fell back to using the agent's email as its id.
 * Task.assigneeId is foreign-keyed to User.id, so the agent appeared in the
 * picker and then failed on assignment.
 *
 * This mirrors ensureAstridAgent() for astrid@astrid.cc, and takes the display
 * name and agent type from AI_AGENT_CONFIG rather than repeating them.
 */

import { prisma } from '../prisma'
import { getAgentIdentity } from './agent-config'
import { createLogger } from '../logger'

const log = createLogger('ai/ensure-agent-user')

export interface AgentUser {
  id: string
  name: string | null
  email: string | null
  image: string | null
}

const AGENT_SELECT = { id: true, name: true, email: true, image: true } as const

/**
 * Return the User row for a registered agent email, creating it if absent.
 * Returns null when the email is not a registered agent.
 *
 * "Registered" spans routed agents and the polling-only local harnesses (`codex@`) —
 * see getAgentIdentity. Both author work; only the former are dispatched to.
 */
export async function ensureAgentUser(email: string, image?: string | null): Promise<AgentUser | null> {
  const identity = getAgentIdentity(email)
  if (!identity) return null

  const existing = await prisma.user.findFirst({
    where: { email, isAIAgent: true },
    select: AGENT_SELECT,
  })
  if (existing) return existing

  try {
    const created = await prisma.user.create({
      data: {
        email,
        name: identity.displayName,
        image: image ?? null,
        isAIAgent: true,
        isActive: true,
        aiAgentType: identity.agentType,
      },
      select: AGENT_SELECT,
    })
    log.info({ email, id: created.id }, 'Created missing AI agent user')
    return created
  } catch (error) {
    // Another request may have created it concurrently — re-read before giving up.
    const raced = await prisma.user.findFirst({ where: { email, isAIAgent: true }, select: AGENT_SELECT })
    if (raced) return raced
    log.error({ err: error, email }, 'Failed to create AI agent user')
    return null
  }
}

/**
 * Create the User rows for offered agents that do not have one (AWTD-992).
 *
 * The list-settings picker reads its agent options from existing User rows, so
 * an agent the caller may be offered but that nobody seeded is invisible there
 * and looks like it does not exist — which is how muse@ went missing in
 * production. One findMany decides which are missing, so the common case
 * (every row already there) costs a single extra query rather than one per
 * agent. ensureAgentUser swallows its own failures; a picker that shows five
 * agents instead of six beats a search that 500s.
 */
export async function ensureOfferedAgentUsers(emails: string[]): Promise<void> {
  if (emails.length === 0) return

  const existing = await prisma.user.findMany({
    where: { email: { in: emails }, isAIAgent: true },
    select: { email: true },
  })
  const have = new Set(existing.map(row => row.email))
  const missing = emails.filter(email => !have.has(email))
  if (missing.length === 0) return

  await Promise.all(missing.map(email => ensureAgentUser(email)))
}
