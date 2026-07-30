/**
 * Available AI Agents API
 *
 * GET /api/user/available-agents — list AI agents the user can use
 *
 * Returns agents based on:
 * 1. Built-in agents for which the user has valid API keys
 * 2. Registered OpenClaw agents the user owns
 * 3. Any AI agent users in the database the user has keys for
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateAPI } from '@/lib/api-auth-middleware'
import { prisma } from '@/lib/prisma'
import { hasValidApiKey } from '@/lib/api-key-cache'
import { ensureAgentUser } from '@/lib/ai/ensure-agent-user'
import { ensureAstridAgent, ASTRID_EMAIL, ASTRID_NAME } from '@/lib/astrid-agent'
import { getBuiltInAgents } from '@/lib/ai/agent-config'
import { createLogger } from '@/lib/logger'

const log = createLogger('user.available-agents')


interface AvailableAgent {
  id: string       // User ID if exists, or email as fallback identifier
  name: string
  email: string
  image: string | null
  service: string
}

// Built-in agents — available when the user holds that provider's API key. Which ones
// exist is configuration (BRAND_ENABLED_AGENTS); the registry owns the list so this
// route and its /api/v1 twin cannot drift apart. Task 97208a72.
const BUILT_IN_AGENTS = getBuiltInAgents()

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAPI(req)

    const available: AvailableAgent[] = []
    let hasAnyKey = false

    // 1. Check built-in agents based on API keys
    for (const agent of BUILT_IN_AGENTS) {
      const hasKey = await hasValidApiKey(auth.userId, agent.service)
      if (hasKey) {
        hasAnyKey = true
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
    }

    // 2. Check OpenClaw agents (registered by this user)
    const hasOpenClaw = await hasValidApiKey(auth.userId, 'openclaw')
    if (hasOpenClaw) {
      const openclawAgents = await prisma.user.findMany({
        where: {
          isAIAgent: true,
          aiAgentType: 'openclaw_worker',
          aiAgentConfig: { contains: auth.userId }, // registered by this user
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

    // 3. Add Astrid as the first option if user has any agent key configured
    if (hasAnyKey || available.length > 0) {
      const astrid = await ensureAstridAgent()
      available.unshift({
        id: astrid.id,
        name: ASTRID_NAME,
        email: ASTRID_EMAIL,
        image: astrid.image,
        service: 'astrid',
      })
    }

    return NextResponse.json({ agents: available })
  } catch (error: any) {
    if (error.name === 'UnauthorizedError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    log.error({ err: error }, '[Available Agents] GET error:')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
