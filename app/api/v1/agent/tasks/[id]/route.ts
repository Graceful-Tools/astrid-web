/**
 * Agent Task Detail API
 *
 * GET /api/v1/agent/tasks/:id — get task details
 * PATCH /api/v1/agent/tasks/:id — update task (complete, priority, etc)
 */

import { NextResponse } from 'next/server'
import { enrichTaskForAgent, agentTaskInclude } from '@/lib/agent-protocol'
import { prisma } from '@/lib/prisma'
import { checkAgentRateLimit, addRateLimitHeaders, AGENT_RATE_LIMITS } from '@/lib/agent-rate-limiter'
import { broadcastToUsers } from '@/lib/sse-utils'
import { getListMemberIds } from '@/lib/list-member-utils'
import { withAgentAuth } from '@/lib/api-agent-auth-wrapper'
import { createLogger } from '@/lib/logger'
import { reconcileTaskLifecycleAfterMutation } from '@/lib/agent-lifecycle-mutations'

const log = createLogger('v1.agent.tasks.id')

type RouteContext = { params: Promise<{ id: string }> }

export const GET = withAgentAuth<RouteContext>(
  { requiredScopes: ['tasks:read'], tag: 'v1.agent.tasks.id' },
  async (req, auth, { params }) => {
    const rateCheck = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.TASKS)
    if (rateCheck.response) return rateCheck.response

    const { id } = await params

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
  }
)

export const PATCH = withAgentAuth<RouteContext>(
  { requiredScopes: ['tasks:read', 'tasks:write'], tag: 'v1.agent.tasks.id' },
  async (req, auth, { params }) => {
    const rateCheck = await checkAgentRateLimit(req, auth, AGENT_RATE_LIMITS.TASKS)
    if (rateCheck.response) return rateCheck.response

    const { id } = await params

    // Agents can only edit tasks assigned to them
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
    await reconcileTaskLifecycleAfterMutation(id, { completed: task.completed })

    try {
      const eventType = body.completed ? 'task_completed' : 'task_updated'
      const recipientIds = new Set<string>()

      if (task.creatorId && task.creatorId !== auth.userId) {
        recipientIds.add(task.creatorId)
      }

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
  }
)
