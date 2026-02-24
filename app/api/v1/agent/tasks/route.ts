/**
 * Agent Tasks API
 *
 * GET /api/v1/agent/tasks — list tasks assigned to the authenticated agent
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAgentRequest, enrichTaskForAgent, agentTaskInclude } from '@/lib/agent-protocol'
import { prisma } from '@/lib/prisma'
import { UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { checkAgentRateLimit, addRateLimitHeaders, AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'

export async function GET(req: NextRequest) {
  try {
    const auth = await authenticateAgentRequest(req)

    const rateCheck = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.TASKS)
    if (rateCheck.response) return rateCheck.response

    const url = new URL(req.url)
    const completedParam = url.searchParams.get('completed')
    const completed = completedParam !== null ? completedParam === 'true' : undefined

    const where: any = {
      assigneeId: auth.userId,
    }

    if (completed !== undefined) {
      where.completed = completed
    }

    const tasks = await prisma.task.findMany({
      where,
      include: agentTaskInclude,
      orderBy: [
        { completed: 'asc' },
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 100,
    })

    return addRateLimitHeaders(
      NextResponse.json({ tasks: tasks.map(enrichTaskForAgent) }),
      rateCheck.headers
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 })
    }
    console.error('[Agent API] GET /agent/tasks error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
