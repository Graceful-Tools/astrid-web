/**
 * API endpoint to check if a user is the coding agent
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUnifiedSession } from '@/lib/session-utils'
import { prisma } from '@/lib/prisma'
import { isCodingAgent } from '@/lib/ai-agent-utils'
import type { RouteContextParams } from '@/types/next'
import { createLogger } from '@/lib/logger'

const log = createLogger('users.[userId].is-coding-agent')


export async function GET(
  request: NextRequest,
  context: RouteContextParams<{ userId: string }>
) {
  try {
    // Verify user session
    const session = await getUnifiedSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { userId } = await context.params

    // Check if the user is a coding agent
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        isAIAgent: true,
        aiAgentType: true,
        isActive: true
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const isCodingAgentUser = isCodingAgent(user) && user.isActive

    return NextResponse.json({
      userId,
      isCodingAgent: isCodingAgentUser,
      isAIAgent: user.isAIAgent,
      aiAgentType: user.aiAgentType
    })

  } catch (error) {
    log.error({ err: error }, 'Error checking if user is coding agent:')
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
