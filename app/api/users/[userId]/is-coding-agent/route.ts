/**
 * API endpoint to check if a user is the coding agent
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'
import { isCodingAgent } from '@/lib/ai-agent-utils'
import type { RouteContextParams } from '@/types/next'

export async function GET(
  request: NextRequest,
  context: RouteContextParams<{ userId: string }>
) {
  try {
    // Verify user session
    const session = await getServerSession(authConfig)
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
    console.error('Error checking if user is coding agent:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
