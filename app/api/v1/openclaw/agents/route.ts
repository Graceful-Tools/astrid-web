/**
 * GET /api/v1/openclaw/agents
 *
 * List the current user's registered OpenClaw agents.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI, UnauthorizedError } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)

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
      try {
        const config = typeof agent.aiAgentConfig === 'string'
          ? JSON.parse(agent.aiAgentConfig)
          : agent.aiAgentConfig
        return config?.registeredBy === auth.userId
      } catch {
        return false
      }
    })

    // Fetch OAuth client status for each agent
    const agents = await Promise.all(
      myAgents.map(async (agent) => {
        const oauthClient = await prisma.oAuthClient.findFirst({
          where: { userId: agent.id, isActive: true },
          select: { clientId: true, lastUsedAt: true, createdAt: true },
        })

        let config: any = {}
        try {
          config = typeof agent.aiAgentConfig === 'string'
            ? JSON.parse(agent.aiAgentConfig)
            : agent.aiAgentConfig || {}
        } catch { /* ignore */ }

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
  } catch (error) {
    if (error instanceof UnauthorizedError || (error as any)?.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[OpenClaw Agents] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
