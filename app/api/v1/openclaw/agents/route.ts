/**
 * GET /api/v1/openclaw/agents
 *
 * List the current user's registered OpenClaw agents.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { AIAgentConfigSchema, parseUserAIConfig } from '@/lib/ai/user-config-schemas'
import { withAuth } from '@/lib/api-auth-wrapper'

export const GET = withAuth(
  { tag: 'v1.openclaw.agents', capability: 'integrationOpenClaw' },
  async (_req, auth) => {
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

    // Filter to agents registered by this user
    const myAgents = agentUsers.filter(agent => {
      const config = parseUserAIConfig(
        agent.aiAgentConfig as string | null | undefined,
        AIAgentConfigSchema,
        'v1/openclaw/agents GET filter'
      )
      return config.registeredBy === auth.userId
    })

    // Fetch OAuth client status for each agent
    const agents = await Promise.all(
      myAgents.map(async (agent) => {
        const oauthClient = await prisma.oAuthClient.findFirst({
          where: { userId: agent.id, isActive: true },
          select: { clientId: true, lastUsedAt: true, createdAt: true },
        })

        const config = parseUserAIConfig(
          agent.aiAgentConfig as string | null | undefined,
          AIAgentConfigSchema,
          'v1/openclaw/agents GET map'
        )

        const lastActiveAt = oauthClient?.lastUsedAt
        const isActive = lastActiveAt && (Date.now() - new Date(lastActiveAt).getTime()) < 24 * 60 * 60 * 1000

        return {
          id: agent.id,
          email: agent.email,
          name: agent.name,
          image: agent.image || null,
          agentName: config.agentName || agent.email?.split('.oc@')[0] || '',
          status: isActive ? 'active' : 'idle',
          registeredAt: config.registeredAt || agent.createdAt?.toISOString(),
          lastActiveAt: lastActiveAt?.toISOString() || null,
          oauthClientId: oauthClient?.clientId || null,
        }
      })
    )

    return NextResponse.json({ agents })
  }
)
