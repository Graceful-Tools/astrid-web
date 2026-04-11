/**
 * API endpoint to get coding agent information
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authConfig } from '@/lib/auth-config'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    // Verify user session
    const session = await getServerSession(authConfig)
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
    console.error('Error getting coding agent info:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}