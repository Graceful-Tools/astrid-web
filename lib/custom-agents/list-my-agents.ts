/**
 * The Custom Agents a user registered.
 *
 * A Custom Agent is a bot User row (aiAgentType 'openclaw_worker') whose
 * registrant is recorded inside its aiAgentConfig, not in a column, so
 * "mine" is a filter over the parsed config. One copy of that filter: the
 * agents list route and the Connections list both need exactly it.
 */

import { prisma } from '@/lib/prisma'
import { AIAgentConfigSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'

export interface CustomAgentUser {
  id: string
  email: string
  name: string | null
  image: string | null
  createdAt: Date | null
  config: ReturnType<typeof parseUserAIConfig<typeof AIAgentConfigSchema>>
}

export async function listMyCustomAgentUsers(userId: string, context = 'custom-agents'): Promise<CustomAgentUser[]> {
  const agentUsers = await prisma.user.findMany({
    where: {
      isAIAgent: true,
      aiAgentType: 'openclaw_worker',
    },
    select: {
      id: true,
      email: true,
      name: true,
      image: true,
      aiAgentConfig: true,
      createdAt: true,
    },
  })

  return agentUsers
    .map(agent => ({
      id: agent.id,
      email: agent.email,
      name: agent.name,
      image: agent.image,
      createdAt: agent.createdAt,
      config: parseUserAIConfig(
        agent.aiAgentConfig as string | null | undefined,
        AIAgentConfigSchema,
        `${context} registeredBy filter`
      ),
    }))
    .filter(agent => agent.config.registeredBy === userId)
}
