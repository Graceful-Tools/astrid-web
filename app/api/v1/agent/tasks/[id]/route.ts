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
import { withAgentAuth } from '@/lib/api-agent-auth-wrapper'
import { detectPlatform } from '@/lib/analytics-events'
import { updateTaskWithSideEffects, type UpdateTaskIntent } from '@/services/task.service'

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

    // Agents can only edit tasks assigned to them. This is the surface's own
    // authorisation, and it stays here — the service authorises lists, not
    // callers.
    const existing = await prisma.task.findFirst({
      where: { id, assigneeId: auth.userId },
      include: {
        lists: {
          select: {
            id: true,
            name: true,
            listType: true,
            listMembers: { select: { userId: true, role: true } },
          },
        },
      },
    })

    if (!existing) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 })
    }

    const body = await req.json()

    // An agent may write four fields plus the closed reason. Every completion
    // rule that follows — the stamp, the statusRole clearing, the repeating
    // roll-forward, reminders, events — belongs to the shared update verb
    // (epic 9dedd8aa); this handler used to re-implement them, and before task
    // fb94f2ee it implemented none of them.
    const intent: UpdateTaskIntent = {}
    if (body.completed !== undefined) intent.completed = body.completed
    if (body.priority !== undefined) intent.priority = body.priority
    if (body.title !== undefined) intent.title = body.title
    if (body.description !== undefined) intent.description = body.description
    if (body.closedReason !== undefined) intent.closedReason = body.closedReason
    if (body.completedAt !== undefined) intent.completedAt = body.completedAt
    if (body.completedSource !== undefined) intent.completedSource = body.completedSource
    if (body.localCompletionDate !== undefined) {
      intent.localCompletionDate = body.localCompletionDate
    }

    const result = await updateTaskWithSideEffects({
      taskId: id,
      actorId: auth.userId,
      actorType: 'agent',
      platform: detectPlatform(req),
      intent,
      existingTask: existing,
      include: agentTaskInclude as never,
      cancelWorkflowReason: 'Task marked as completed by agent',
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return addRateLimitHeaders(
      NextResponse.json({ task: enrichTaskForAgent(result.task) }),
      rateCheck.headers
    )
  }
)
