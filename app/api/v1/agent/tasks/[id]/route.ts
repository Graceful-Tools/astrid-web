/**
 * Agent Task Detail API
 *
 * GET /api/v1/agent/tasks/:id — get task details
 * PATCH /api/v1/agent/tasks/:id — update task (complete, priority, etc)
 */

import { type NextRequest, NextResponse } from 'next/server'
import { authenticateAgentRequest, enrichTaskForAgent, agentTaskInclude } from '@/lib/agent-protocol'
import { prisma } from '@/lib/prisma'
import { UnauthorizedError, ForbiddenError } from '@/lib/api-auth-middleware'
import { checkAgentRateLimit, addRateLimitHeaders, AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { createLogger } from '@/lib/logger'

const log = createLogger('v1.agent.tasks.id')

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAgentRequest(req)

    const rateCheck = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.TASKS)
    if (rateCheck.response) return rateCheck.response

    const { id } = await context.params

    const task = await prisma.task.findFirst({
      where: { id, assigneeId: auth.userId },
      include: agentTaskInclude,
    })

    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    return addRateLimitHeaders(
      NextResponse.json({ task: enrichTaskForAgent(task) }),
      rateCheck.headers
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 })
    }
    log.error({ err: error }, 'GET /agent/tasks/:id error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const auth = await authenticateAgentRequest(req, ['tasks:read', 'tasks:write'])

    const rateCheck = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.TASKS)
    if (rateCheck.response) return rateCheck.response

    const { id } = await context.params

    // Verify agent owns this task
    const existing = await prisma.task.findFirst({
      where: { id, assigneeId: auth.userId },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const body = await req.json()
    const data: any = {}

    if (body.completed !== undefined) data.completed = body.completed
    if (body.priority !== undefined) data.priority = body.priority
    if (body.title !== undefined) data.title = body.title
    if (body.description !== undefined) data.description = body.description

    const task = await prisma.task.update({
      where: { id },
      data,
      include: agentTaskInclude,
    })

    // Broadcast SSE event to task creator and list members
    try {
      const eventType = body.completed ? 'task_completed' : 'task_updated'
      const recipientIds = new Set<string>()

      // Add task creator
      if (task.creatorId && task.creatorId !== auth.userId) {
        recipientIds.add(task.creatorId)
      }

      // Add list members
      for (const list of (task as any).lists || []) {
        const memberIds = getListMemberIds(list)
        memberIds.forEach((mid: string) => {
          if (mid !== auth.userId) recipientIds.add(mid)
        })
      }

      if (recipientIds.size > 0) {
        broadcastToUsers(Array.from(recipientIds), {
          type: eventType,
          timestamp: new Date().toISOString(),
          data: {
            taskId: task.id,
            task: enrichTaskForAgent(task),
          },
        })
      }
    } catch (sseError) {
      log.error({ err: sseError }, 'SSE broadcast error')
    }

    return addRateLimitHeaders(
      NextResponse.json({ task: enrichTaskForAgent(task) }),
      rateCheck.headers
    )
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: (error as Error).message }, { status: 403 })
    }
    log.error({ err: error }, 'PATCH /agent/tasks/:id error')
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
