/**
 * Agent Tasks API
 *
 * GET /api/v1/agent/tasks — list tasks assigned to the authenticated agent
 */

import { NextResponse } from 'next/server'
import { enrichTaskForAgent, agentTaskInclude } from '@/lib/agent-protocol'
import { prisma } from '@/lib/prisma'
import { checkAgentRateLimit, addRateLimitHeaders, AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'
import { withAgentAuth } from '@/lib/api-agent-auth-wrapper'

export const GET = withAgentAuth(
  { requiredScopes: ['tasks:read'], tag: 'v1.agent.tasks' },
  async (req, auth) => {
    const rateCheck = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.TASKS)
    if (rateCheck.response) return rateCheck.response

    const url = new URL(req.url)
    const completedParam = url.searchParams.get('completed')
    const completed = completedParam !== null ? completedParam === 'true' : undefined

    const where: any = { assigneeId: auth.userId }
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
  }
)
