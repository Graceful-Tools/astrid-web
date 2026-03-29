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

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { hasValidApiKey } from '@/lib/api-key-cache'
import { ensureAstridAgent, ASTRID_EMAIL } from '@/lib/astrid-agent'

interface AvailableAgent {
  id: string       // User ID if exists, or email as fallback identifier
  name: string
  email: string
  image: string | null
  service: string
}

// Built-in agents — always available if user has the API key
const BUILT_IN_AGENTS: Array<{ email: string; name: string; service: 'claude' | 'openai' | 'gemini'; image: string | null }> = [
  { email: 'claude@astrid.cc', name: 'Claude', service: 'claude', image: '/images/ai-agents/claude.svg' },
  { email: 'openai@astrid.cc', name: 'OpenAI', service: 'openai', image: '/images/ai-agents/openai.svg' },
  { email: 'gemini@astrid.cc', name: 'Gemini', service: 'gemini', image: '/images/ai-agents/gemini.svg' },
]

export async function GET() {
  try {
    const session = await getServerSession(authConfig)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const available: AvailableAgent[] = []
    let hasAnyKey = false

    // 1. Check built-in agents based on API keys
    for (const agent of BUILT_IN_AGENTS) {
      const hasKey = await hasValidApiKey(session.user.id, agent.service)
      if (hasKey) {
        hasAnyKey = true
        // Try to find the agent's User record for the real ID
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

    // 2. Check OpenClaw agents (registered by this user)
    const hasOpenClaw = await hasValidApiKey(session.user.id, 'openclaw')
    if (hasOpenClaw) {
      const openclawAgents = await prisma.user.findMany({
        where: {
          isAIAgent: true,
          aiAgentType: 'openclaw_worker',
          aiAgentConfig: { contains: session.user.id }, // registered by this user
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
        name: 'Astrid',
        email: ASTRID_EMAIL,
        image: astrid.image,
        service: 'astrid',
      })
    }

    return NextResponse.json({ agents: available })
  } catch (error) {
    console.error('[Available Agents] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
