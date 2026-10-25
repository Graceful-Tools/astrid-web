/**
 * API endpoint to get coding agent information
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { createLogger } from '@/lib/logger'
import { capabilityGate } from '@/lib/brand/capabilities'

const log = createLogger('coding-agent.info')


export async function GET(request: NextRequest) {
  // A deployment without the coding agent must refuse server-side (AWTD-1094).
  const capabilityBlocked = capabilityGate('codingAgent')
  if (capabilityBlocked) return capabilityBlocked

  try {
    // Verify user session
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find the coding agent
    const codingAgent = await prisma.user.findFirst({
      where: {
        isAIAgent: true,
        aiAgentType: 'coding_agent'
      },
      select: {
        id: true,
        name: true,
        email: true,
        aiAgentConfig: true,
        mcpEnabled: true,
        isActive: true,
        createdAt: true
      }
    })

    if (!codingAgent) {
      return NextResponse.json({ error: 'Coding agent not found' }, { status: 404 })
    }

    return NextResponse.json({
      agentId: codingAgent.id,
      agent: codingAgent
    })

  } catch (error) {
    log.error({ err: error }, 'Error getting coding agent info:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}