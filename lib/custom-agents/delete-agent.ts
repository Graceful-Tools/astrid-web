/**
 * Delete a Custom Agent the caller registered.
 *
 * Deleting the bot User cascades to its OAuthClient and every OAuthToken, so
 * this is the whole of "revoke a Custom Agent". Ownership is the registrant
 * recorded in aiAgentConfig; anything else — missing, a different agent
 * type, somebody else's — answers null so the caller can say "not found"
 * without confirming the row exists.
 */

import { prisma } from '@/lib/prisma'
import { AIAgentConfigSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'
import { createLogger } from '@/lib/logger'

const log = createLogger('custom-agents.delete')

export async function deleteCustomAgent(
  userId: string,
  agentId: string,
  deletedBy?: string | null
): Promise<{ email: string } | null> {
  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { id: true, email: true, aiAgentType: true, aiAgentConfig: true },
  })

  if (!agent || agent.aiAgentType !== 'openclaw_worker') return null

  const config = parseUserAIConfig(
    agent.aiAgentConfig as string | null | undefined,
    AIAgentConfigSchema,
    'custom-agents delete ownership'
  )
  if (config.registeredBy !== userId) return null

  // Delete user — cascades to OAuthClient and OAuthToken
  await prisma.user.delete({ where: { id: agentId } })

  log.info({ agentEmail: agent.email, deletedBy: deletedBy ?? userId }, 'Deleted Custom Agent')

  return { email: agent.email }
}
