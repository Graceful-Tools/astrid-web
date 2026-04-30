/**
 * GET /api/v1/users/me/available-agents
 *
 * Lists AI agents the authenticated user can use:
 * - Built-in agents (claude/openai/gemini) for which a valid API key is configured
 * - OpenClaw agents the user registered
 * - Astrid as the always-available default if any agent key exists
 *
 * Mirrors GET /api/user/available-agents.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/api-auth-wrapper'
import { prisma } from '@/lib/prisma'
import { hasValidApiKey } from '@/lib/api-key-cache'
import { ensureAstridAgent, ASTRID_EMAIL } from '@/lib/astrid-agent'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.users.me.available-agents')

interface AvailableAgent {
  id: string
  name: string
  email: string
  image: string | null
  service: string
}

const BUILT_IN_AGENTS: Array<{
  email: string; name: string; service: 'claude' | 'openai' | 'gemini'; image: string | null
}> = [
  { email: 'claude@astrid.cc', name: 'Claude', service: 'claude', image: '/api/v1/agent-icon/claude' },
  { email: 'openai@astrid.cc', name: 'OpenAI', service: 'openai', image: '/api/v1/agent-icon/openai' },
  { email: 'gemini@astrid.cc', name: 'Gemini', service: 'gemini', image: '/api/v1/agent-icon/gemini' },
]

export const GET = withAuth(
  { scopes: ['user:read'], tag: 'v1.users.me.available-agents' },
  async (_req, auth) => {
    try {
      const available: AvailableAgent[] = []
      let hasAnyKey = false

      for (const agent of BUILT_IN_AGENTS) {
        if (await hasValidApiKey(auth.userId, agent.service)) {
          hasAnyKey = true
          const agentUser = await prisma.user.findFirst({
            where: { email: agent.email, isAIAgent: true },
            select: { id: true },
          })
          available.push({
            id: agentUser?.id || agent.email,
            name: agent.name,
            email: agent.email,
            image: agent.image,
            service: agent.service,
          })
        }
      }

      if (await hasValidApiKey(auth.userId, 'openclaw')) {
        const openclawAgents = await prisma.user.findMany({
          where: {
            isAIAgent: true,
            aiAgentType: 'openclaw_worker',
            aiAgentConfig: { contains: auth.userId },
          },
          select: { id: true, name: true, email: true, image: true },
        })
        for (const a of openclawAgents) {
          available.push({
            id: a.id,
            name: a.name || a.email,
            email: a.email,
            image: a.image,
            service: 'openclaw',
          })
        }
      }

      if (hasAnyKey || available.length > 0) {
        const astrid = await ensureAstridAgent()
        available.unshift({
          id: astrid.id,
          name: 'Astrid',
          email: ASTRID_EMAIL,
          image: astrid.image,
          service: 'astrid',
        })
      }

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
