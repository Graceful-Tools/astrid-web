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
import { diffTaskEvents, recordTaskEvents } from '@/lib/task-events'
import { notifyTaskUpdate } from '@/lib/notification-store'
import { rescheduleRemindersForUpdate } from '@/lib/reminder-scheduling'
import { cancelActiveCodingWorkflow } from '@/lib/tasks/cancel-active-coding-workflow'
import { resolveRepeatingTaskCompletion } from '@/lib/task-update-handler'
import { applyRepeatingTaskRollForward } from '@/lib/repeating-task-handler'
import { parseClosedReason } from '@/lib/closed-reason'
import { RedisCache, isRedisAvailable } from '@/lib/redis'
import { createLogger } from '@/lib/logger'

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
    const data: Record<string, unknown> = {}

    if (body.completed !== undefined) data.completed = body.completed
    if (body.priority !== undefined) data.priority = body.priority
    if (body.title !== undefined) data.title = body.title
    if (body.description !== undefined) data.description = body.description

    // Terminal state other than done (task 11042ae3), parsed exactly as the
    // web and v1 routes parse it.
    if (body.closedReason !== undefined && data.completed !== false) {
      const parsed = parseClosedReason(body.closedReason)
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 })
      }
      data.closedReason = parsed.value
    }

    // Completion semantics, identical to the other two write surfaces. This
    // handler used to be a raw prisma.task.update: no completion stamp, no
    // statusRole clearing (breaking the schema invariant), no repeating
    // roll-forward — so an agent completing a repeating task killed the series
    // outright (task fb94f2ee).
    if (data.completed === true) {
      data.completedAt = body.completedAt ? new Date(body.completedAt) : new Date()
      data.completedSource =
        typeof body.completedSource === 'string' && body.completedSource
          ? body.completedSource
          : 'astrid'
      // Done carries no board status.
      data.statusRole = null
    } else if (data.completed === false) {
      data.completedAt = null
      data.completedSource = null
      // Reopening clears the terminal reason — a reopened task is not a
      // canceled one.
      data.closedReason = null
    }

    // A repeating occurrence rolls forward instead of staying completed, unless
    // it was closed as canceled/duplicate/not-planned.
    const repeatingResult = await resolveRepeatingTaskCompletion({
      taskId: id,
      existingCompleted: existing.completed,
      dataCompleted: body.completed,
      localCompletionDate: body.localCompletionDate ?? undefined,
      closedReason: body.closedReason,
    })

    if (repeatingResult) {
      await applyRepeatingTaskRollForward(id, repeatingResult)

      const rolled = await prisma.task.findUnique({
        where: { id },
        include: agentTaskInclude,
      })

      return addRateLimitHeaders(
        NextResponse.json({ task: rolled ? enrichTaskForAgent(rolled) : null }),
        rateCheck.headers
      )
    }

    if (data.completed === true && !existing.completed) {
      await cancelActiveCodingWorkflow({
        taskId: id,
        reason: 'Task marked as completed by agent',
      })
    }

    const task = await prisma.task.update({
      where: { id },
      data,
      include: agentTaskInclude,
    })

    // Reminders must follow the task, or a completed task keeps notifying.
    if (existing.completed !== task.completed || existing.assigneeId !== task.assigneeId) {
      await rescheduleRemindersForUpdate({
        taskId: task.id,
        taskTitle: task.title,
        userId: task.assigneeId || task.creatorId || auth.userId,
        dueDateTime: task.dueDateTime ?? null,
        completed: !!task.completed,
      })
    }

    // Structured activity history + notification, same helpers as the other
    // surfaces. An agent silently reassigning or completing work must leave the
    // same trace a human would.
    const events = diffTaskEvents(
      {
        title: existing.title,
        completed: existing.completed,
        closedReason: existing.closedReason,
        priority: existing.priority,
        assigneeId: existing.assigneeId,
        dueDateTime: existing.dueDateTime,
        listIds: [],
      },
      {
        title: task.title,
        completed: task.completed,
        closedReason: task.closedReason,
        priority: task.priority,
        assigneeId: task.assigneeId,
        dueDateTime: task.dueDateTime,
        listIds: [],
      }
    )

    await recordTaskEvents({
      taskId: id,
      actorId: auth.userId,
      actorType: 'agent',
      events,
    })

    await notifyTaskUpdate({
      taskId: id,
      actorId: auth.userId,
      events,
      audience: {
        assigneeId: task.assigneeId,
        creatorId: task.creatorId,
        commenterIds: [],
      },
    })

    // Everyone whose view of this task just changed. Computed once and used
    // for both the SSE broadcast and the cache invalidation below — they had
    // drifted into answering the same question two different ways.
    const recipientIds = new Set<string>()
    if (task.creatorId && task.creatorId !== auth.userId) {
      recipientIds.add(task.creatorId)
    }
    for (const list of (task as { lists?: unknown[] }).lists || []) {
      for (const memberId of getListMemberIds(list as never)) {
        if (memberId !== auth.userId) recipientIds.add(memberId)
      }
    }

    // Cached task lists go stale the moment the row changes. Without this an
    // agent's completion stayed invisible to every other client until the
    // cache expired.
    try {
      if (await isRedisAvailable()) {
        const affected = new Set<string>(recipientIds)
        if (task.assigneeId) affected.add(task.assigneeId)
        if (task.creatorId) affected.add(task.creatorId)
        await Promise.all(
          Array.from(affected).map(userId => RedisCache.del(RedisCache.keys.userTasks(userId)))
        )
      }
    } catch (cacheError) {
      log.error({ err: cacheError }, 'Failed to invalidate task cache')
    }

    try {
      const eventType = body.completed ? 'task_completed' : 'task_updated'

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
