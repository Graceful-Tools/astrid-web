/**
 * GET /api/v1/custom-agents/agents
 *
 * List the current user's registered Custom Agents.
 */

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { listMyCustomAgentUsers } from '@/lib/custom-agents/list-my-agents'
import { withAuth } from '@/lib/api-auth-wrapper'

export const GET = withAuth(
  { tag: 'v1.custom-agents.agents', capability: 'integrationCustomAgents' },
  async (_req, auth) => {
    const myAgents = await listMyCustomAgentUsers(auth.userId, 'v1/custom-agents/agents GET')

    // Fetch OAuth client status for each agent
    const agents = await Promise.all(
      myAgents.map(async (agent) => {
        const oauthClient = await prisma.oAuthClient.findFirst({
          where: { userId: agent.id, isActive: true },
          select: { clientId: true, lastUsedAt: true, createdAt: true },
        })

        const config = agent.config

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
